---
libs:
  bullmq:
    version: "5.81.5"
    context7_id: "/taskforcesh/bullmq/v5.81.5"
    fetched_at: "2026-11-06"
  "@aws-sdk/client-s3":
    version: "3.1164.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-06"
  "@aws-sdk/s3-request-presigner":
    version: "3.1164.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-06"
  "@aws-sdk/lib-storage":
    version: "3.1164.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-06"
  "@smithy/node-http-handler":
    version: "4.14.2 (transitive)"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-18"
  express:
    version: "5.2.1"
    context7_id: "/expressjs/express"
    fetched_at: "2026-11-18"
  "@nestjs/swagger":
    version: "11.4.2"
    context7_id: "/nestjs/swagger"
    fetched_at: "2026-11-18"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-07T14:51:09.062534+00:00"
  nestjs-project/package.json: "2026-11-06T21:14:04.569758+00:00"
  nestjs-project/package-lock.json: "2026-11-06T21:14:04.567756+00:00"
---

# Referências de bibliotecas — vídeos

## Estado atual verificado em 2026-11-18

O manifesto/lockfile efetivo contém AWS SDK S3 3.1164.0, Express 5.2.1 e
`@nestjs/swagger` 11.4.2. `@smithy/node-http-handler` 4.14.2 é transitivo; ele não
foi promovido a dependência direta porque o cliente AWS aceita a configuração
do `requestHandler` como objeto. `npm ci` no container concluiu sem comando de
upgrade. As integrações atuais de MinIO, Range/HEAD, stream e worker FFmpeg foram
executadas após a remediação; isso é evidência da execução de 18/11, não uma
afirmação retroativa sobre a rodada de planejamento.

Reconsultas oficiais via Context7:

- `/aws/aws-sdk-js-v3`: `connectionTimeout`, `requestTimeout`,
  `throwOnRequestTimeout` e `client.send(command, { abortSignal })`; o handler
  pode ser configurado sem import direto desde SDK v3.521.0+;
- `/expressjs/express` (snapshot 5.2.0, próximo ao 5.2.1 instalado):
  `express.json` com `type`, `strict` e `limit`; os testes na versão efetiva
  comprovam charset, chunked, gzip/deflate e limite sobre bytes descomprimidos;
- `/nestjs/swagger` (snapshot 11.4.7, mesma linha 11.4 da 11.4.2 instalada):
  `ApiResponse` registra status/schema/headers e `ApiBearerAuth(name)` referencia
  o nome exato do security scheme. O documento em memória e o export das 12
  operações foram testados na versão efetiva;
- `/taskforcesh/bullmq/v5.81.5`: workers mantêm reconexão Redis; a readiness
  atual combina estado do consumer e `PING`, em vez de confiar só no arquivo.

## Histórico de planejamento de 2026-11-06

Naquela rodada, versões propostas foram confirmadas por consulta HTTP ao
registry npm; nenhum pacote foi instalado nem o lockfile alterado **naquela
rodada**. As consultas Context7
cobriram três famílias: BullMQ, integração NestJS e SDK AWS v3. A consulta AWS
cobriu conjuntamente os três pacotes; não foram cinco consultas independentes.
FFmpeg e Node são binários/runtime, não novos pacotes npm.

### bullmq

`Queue.add(name, data, {jobId, attempts, backoff})`; jobId sem `:`. Duplicatas podem
ser entregues apesar de jobId: persistir idempotência no banco. Worker não deve
bloquear event loop com FFmpeg síncrono. Redis com persistência e `noeviction`.
Worker mantém reconexão; publisher tem timeout/retry limitado por tentativa e
outbox persistente. Fechar conexões e jobs graciosamente no shutdown.
Documentação Context7 fixada em 5.81.5. Registry confirmou engines e existência.
Última major consultada foi 6, deliberadamente não adotada.

- [Documentação da versão](https://github.com/taskforcesh/bullmq/tree/v5.81.5/docs/gitbook).
- [Metadados exatos](https://registry.npmjs.org/bullmq/5.81.5).

### @nestjs/bullmq — avaliado e não adotado

Foi avaliado no planejamento inicial, mas a implementação final usa `Queue` e
`Worker` de `bullmq` diretamente dentro do `VideoWorkerModule` standalone. A
busca de imports confirmou ausência de `BullModule`, decorators e injeções do
adapter; por isso o pacote foi removido do manifesto e lockfile em 17/11/2026.
Os links abaixo são preservados como registro da alternativa analisada.

- [Documentação oficial NestJS](https://docs.nestjs.com/techniques/queues).
- [Metadados exatos](https://registry.npmjs.org/@nestjs%2fbullmq/11.0.4).

### @aws-sdk/client-s3

Usar dois clients configurados para endpoints interno e público; `forcePathStyle`
para MinIO, region e credentials centralizados. `CreateMultipartUploadCommand`,
`UploadPartCommand`, `ListPartsCommand`, `CompleteMultipartUploadCommand`,
`AbortMultipartUploadCommand`, `HeadObjectCommand`, `GetObjectCommand`,
`ListMultipartUploadsCommand` e delete para limpeza. Completar a partir de partes
verificadas no storage; paginar listagens. Consumir GetObject como stream.
Configurar timeouts e retries limitados; não aceitar URLs/keys arbitrárias.

- [SDK oficial](https://github.com/aws/aws-sdk-js-v3).
- [Versão exata](https://registry.npmjs.org/@aws-sdk%2fclient-s3/3.1164.0).
- [Limites multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html).

### @aws-sdk/s3-request-presigner

`getSignedUrl(client, command, {expiresIn})` assina a operação e host de destino.
Content-Length de cada parte e headers obrigatórios devem entrar na assinatura;
verificar `X-Amz-SignedHeaders` e recusa real a tamanho divergente no MinIO.
URLs não dão autorização de negócio: primeiro validar usuário/canal/status.
HEAD deve usar assinatura HEAD própria; não reutilizar GET assinado como HEAD.
Resposta de download define `ResponseContentDisposition`; stream define inline.

- [README oficial do presigner](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner).
- [Versão exata](https://registry.npmjs.org/@aws-sdk%2fs3-request-presigner/3.1164.0).

### @aws-sdk/lib-storage

`Upload` publica derivados grandes do worker sem carregar tudo em memória:
Body como read stream, partSize 64MiB, queueSize 2, leavePartsOnError false.
Não usar na API como proxy de upload do usuário. Cancelar em falha/deadline.
Registry exige client-s3 ^3.1164.0; ambos serão pinados em 3.1164.0.

- [Código e README oficiais](https://github.com/aws/aws-sdk-js-v3/tree/main/lib/lib-storage).
- [Versão exata](https://registry.npmjs.org/@aws-sdk%2flib-storage/3.1164.0).

As docs AWS consultadas são da branch main. Os pacotes exatos existem e exigem
Node ≥20; o Dockerfile atual usa Node 25.6.0. API compatível não equivale a teste
de integração: rodar os contratos reais antes de afirmar compatibilidade MinIO.

Reconsulta de implementação em 17/11/2026: Context7 resolveu o repositório
oficial `/aws/aws-sdk-js-v3` e retornou o README de `lib-storage` na versão
3.1153.0, a mais próxima indexada da instalada 3.1164.0. O contrato confirma
`partSize`, `queueSize`, `leavePartsOnError`, `done()` e abort de requests por
`AbortSignal`; o `.d.ts` local de 3.1164.0 confirmou adicionalmente
`Upload.abort(): Promise<void>`. A implementação foi validada contra MinIO real,
inclusive abort de multipart parcial, portanto a pequena divergência do snapshot
documental não foi tratada como equivalência sem teste.

### Runtime e imagens

- FFmpeg/ffprobe: binários com versão fixada na imagem do worker; gravar versão
  e digest em SI-03.2. Sem fluent-ffmpeg. JSON ffprobe `show_format/show_streams`,
  seleção de campos, limite de saída, `spawn` sem shell e protocolo local apenas.
- Redis: série 7.4, patch/digest imutável registrado no Compose durante SI-03.2.
- MinIO: build do source release `RELEASE.2025-10-15T17-29-55Z`, commit imutável
  resolvido antes do build, versão Go conforme go.mod do release. Manter notices
  do upstream; bootstrap do bucket via SDK já pinado, sem depender de mc latest.
- `node:crypto`, `node:stream`, `node:child_process`: módulos nativos do runtime.

Fixar digest de imagem e versão do pacote Debian FFmpeg é trabalho de build em
SI-03.2; nenhuma imagem foi construída, pulled ou executada nesta rodada.

Fontes: [ffprobe](https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffprobe.texi),
[muxer MP4](https://github.com/FFmpeg/FFmpeg/blob/master/doc/muxers.texi),
[Node streams](https://nodejs.org/api/stream.html),
[MinIO release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).

Revisão adicional em 2026-11-07: o adiamento de job ativo deve usar a API de delay
e seu sinal de controle, evitando retorno normal de sucesso. Conferir assinatura
na versão instalada durante SI-03.11; testar lease ocupada e backoff no Redis real.
[Documentação oficial do padrão](https://docs.bullmq.io/patterns/process-step-jobs).

### Contratos externos conferidos na revisão de 2026-11-07

- MinIO do release escolhido retorna NotImplemented em PutBucketCors. Configurar
  MINIO_API_CORS_ALLOW_ORIGIN no serviço; init SDK não deve usar BucketCORS.
  AWS S3 mantém configuração por bucket. Conferido via Context7 `/minio/minio`
  e [handler do release](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/dummy-handlers.go),
  [configuração do release](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/docs/config/README.md).
- CompleteMultipartUpload concatena as partes fornecidas, não conhece o tamanho
  cadastrado pela aplicação; recuperação precisa repetir todas as validações.
  [Contrato S3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html).
- Expiração da assinatura é verificada ao iniciar a requisição: transferência
  já iniciada pode continuar. [URLs pré-assinadas S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
- FFmpeg streamcopy não decodifica; validar corrupção requer decode separado.
  Seleção automática pode escolher tracks diferentes; fixar índices por `-map`.
  Tratar erros de decode como fatais (incluindo opção global `-xerror`) e testar
  fixture corrompida no binário pinado, respeitando deadline total.
  [Documentação oficial FFmpeg](https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffmpeg.texi).

Essas consultas comprovam os contratos documentados, não execução local. Testes
de integração das versões pinadas permanecem pendentes para a implementação.
