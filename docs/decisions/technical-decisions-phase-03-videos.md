---
scope_type: phase
related_phases: [3]
review_status: implemented
decision_author: agent-proposal
---

# Decisões técnicas — Fase 03: vídeos

Data: 2026-11-06. Escopo: planejamento completo do backend, sem implementação.
As escolhas abaixo fecham a proposta técnica para revisão; não representam
aprovação prévia do usuário. Fonte funcional: Fase 03 de `docs/project-plan.md`.
_Subprojects in scope:_ `nestjs-project/`; infraestrutura do backend.
Frontend, publicação, catálogo e interações sociais não fazem parte desta fase.

## TD-01: Fila e execução isolada

**Scope:** Backend
**Capability:** Serviço de processamento em segundo plano (filas)

### Option A: BullMQ + Redis
Jobs TypeScript, retries/backoff e integração NestJS. **Pros:** encaixe na stack,
worker independente e poucas peças. **Cons:** Redis precisa persistência e
`noeviction`; entrega pode repetir, exigindo idempotência.

### Option B: RabbitMQ
Broker dedicado, acknowledgements e routing. **Pros:** protocolos e roteamento
maduros. **Cons:** retry/delay, deduplicação e acompanhamento dos jobs exigem mais
código para esta fila única.

### Option C: Fila PostgreSQL com biblioteca dedicada
Reutiliza o banco. **Pros:** menos um serviço. **Cons:** carga de jobs compete com
API e adiciona um modelo de operação menos alinhado ao worker Nest da proposta.

**Recommendation:** A — BullMQ 5 direto em Redis 7.4 com AOF e `noeviction`,
worker Nest sem servidor HTTP, `concurrency=1`, separado da API. Preservar NestJS 11; não
migrar para BullMQ 6 ou NestJS 12 durante a fase.
**Decision:** A — implementada com `Queue`/`Worker` diretos; a integração
`@nestjs/bullmq` avaliada inicialmente não é necessária.
**Libraries:** bullmq@5.81.5

## TD-02: Upload retomável e limite de tamanho

**Scope:** Backend
**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

### Option A: Multipart S3 pré-assinado
API controla sessões e autoriza partes; cliente envia bytes diretamente ao
storage. **Pros:** retoma partes, memória da API independe do tamanho.
**Cons:** requer coordenação, expiração, CORS e validação da conclusão.

### Option B: Servidor tus separado
Protocolo de upload retomável. **Pros:** clientes prontos e offsets simples.
**Cons:** novo serviço/protocolo e integração adicional com S3 e domínio.

**Recommendation:** A — limite inclusivo de **10.000.000.000 bytes** (10GB
decimal), partes de 64MiB, última parte menor; no máximo 150 partes. Sessão
expira em 24h; URLs duram min(15min, prazo restante inteiro da sessão), sem
renovar a sessão. Nenhuma assinatura após o prazo ou em completing. PUT rejeitado
não fecha a sessão; reenviar a parte correta continua permitido. O cliente
escolhe até 4 envios simultâneos. A API recebe apenas JSON de controle, até 64KiB.
Assinatura é restrita a key/uploadId/partNumber e tamanho esperado. Verificar
`ListParts` paginado, tamanhos/ETags e soma antes de completar; confirmar tamanho
via `HeadObject` depois. Abort/cleanup remove uploads inválidos ou expirados.
Não confiar em tamanho, ETag ou key enviados pelo cliente. Validar em MinIO real
que Content-Length assinado rejeita parte maior; esse teste é obrigatório.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** @aws-sdk/client-s3@3.1164.0, @aws-sdk/s3-request-presigner@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: Assinaturas limitadas pelo prazo restante; PUT rejeitado permite reenvio.


## TD-03: Organização e acesso ao storage

**Scope:** Backend
**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

S3 compatível/MinIO local é uma restrição já estabelecida, não uma escolha nova.

### Option A: Bucket privado com prefixos por vídeo e tentativa
**Pros:** política única e chaves não derivadas de nomes de usuário. **Cons:**
controle de acesso depende de autorização na API antes de emitir URLs.

### Option B: Buckets separados para originais, streams e thumbnails
**Pros:** políticas independentes. **Cons:** multiplica bootstrap e configuração
sem necessidade nesta fase.

**Recommendation:** A — bucket `streamtube-videos`, keys geradas internamente:
`videos/{videoId}/source.mp4`, `videos/{videoId}/attempts/{attemptId}/stream.mp4`
e `.../thumbnail.jpg`. Bucket privado; nenhuma URL permanente de objeto no banco.
Endpoint interno `http://minio:9000`, endpoint público configurável
`http://localhost:9000` para o cliente no host; nunca reescrever host depois de
assinar. CORS permite apenas origens configuradas e suporta PUT/GET/HEAD com
ETag/Content-Range/Accept-Ranges expostos. No release MinIO escolhido, PutBucketCors
não é implementado: configurar MINIO_API_CORS_ALLOW_ORIGIN no serviço; init SDK
cria bucket/política. S3_BACKEND seleciona minio/aws; em AWS S3, CORS é por bucket.
Testar preflight de origem permitida/proibida e headers no backend selecionado.
Manter originais para download e derivados para play. Não confundir quota de
admissão com capacidade histórica: originais completed (inclusive error) e
derivados vencedores são retidos sem quota vitalícia nesta fase. Runbook documenta
ocupação/capacidade do volume MinIO, alerta e suspensão operacional de admissões;
scratch de 40GiB é separado. Exclusão de vídeos/gestão de retenção ficam fora da fase.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** @aws-sdk/client-s3@3.1164.0, @aws-sdk/lib-storage@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: CORS MinIO global separado de AWS por bucket; limites de retenção explícitos.


## TD-04: Processamento, formatos e thumbnail

**Scope:** Backend
**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

### Option A: MP4 H.264/AAC, remux faststart e thumbnail
ffprobe valida o conteúdo; FFmpeg reorganiza o MP4 sem recodificar e extrai JPEG.
**Pros:** streaming progressivo previsível e custo limitado. **Cons:** não aceita
todo formato/codec de vídeo; é necessário informar essa restrição ao cliente.

### Option B: Transcodificar entradas variadas para MP4
**Pros:** suporte a mais formatos. **Cons:** CPU, duração de jobs e disco aumentam;
amplia bastante a matriz de falhas e testes.

**Recommendation:** A — aceitar MIME declarado `video/mp4`; o conteúdo deve ser
MP4 com vídeo H.264, pixel format `yuv420p`, largura/altura positivas e no máximo
3840x2160, exatamente um vídeo principal não attached_pic e zero ou um áudio AAC.
Os limites são por eixo (`width <= 3840`, `height <= 2160`), sem rotação: portrait
com altura acima de 2160 é rejeitado. O teto de 10.000.000.000 bytes é um limite
de transporte e não significa aceitação de qualquer codec ou estrutura de MP4.
Outros codecs/tracks, capa, legendas ou dados são UNSUPPORTED_VIDEO; arquivo sem
vídeo, erro de demux/decode, duração/fps inválidos são INVALID_VIDEO. Não confiar
na extensão. Usar índices ffprobe explícitos e iguais em validação/remux/thumbnail.
Decodificar integralmente streams selecionados para saída nula com erros fatais;
não prometer detectar defeitos visuais semanticamente válidos. Decode timeout
60min participa do deadline total de 90min; timeout é PROCESSING_TIMEOUT.
Guardar durationMs=Math.round(durationSeconds*1000), positivo/inteiro seguro,
e VideoMetadata tipado: format:'mp4', videoCodec:'h264', audioCodec:'aac'|null,
width/height inteiros positivos e fps:{numerator,denominator}, inteiros positivos
de avg_frame_rate. Rejeitar 0/0/não finito, sem inferir CFR; draft/processing
mantêm metadata/durationMs null, preenchidos juntos na transação ready.
Gerar MP4 `-c copy -movflags +faststart` e JPEG de largura máxima 640, mantendo
proporção, no instante `min(1, durationSeconds/2)`.

Invocar binários com `child_process.spawn`, argumentos separados, sem shell e
sem wrapper npm. Usar apenas arquivos locais e protocolos locais permitidos;
rejeitar playlists/referências externas. Download/upload do worker com streams e
backpressure, diretório temporário por tentativa, cleanup em finally e no boot.
ffprobe timeout 60s, remux 60min; concorrência 1 e reserva de disco de pelo menos
`2 * sizeBytes + 1GiB` antes de iniciar. Volume de trabalho recomendado ≥40GiB.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** FFmpeg/ffprobe (binários do container), node:child_process, node:stream

**Revisions:**
- 2026-11-06 — Resolve AMB-1: thumbnail timeout 60s, stdout JSON do ffprobe no
  máximo 1MiB e stderr em ring buffer de 64KiB. Cada tentativa completa tem
  deadline de 90min, incluindo I/O; matar subprocessos ao perder lease.
- 2026-11-07 — Revisão detalhada: Decode integral, seleção explícita e metadata tipado dentro do deadline total.


## TD-05: Streaming e download

**Scope:** Backend
**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

### Option A: MP4 faststart com HTTP Range no object storage
**Pros:** 206, seek e início antes do download completo, sem levar bytes à API.
**Cons:** sem bitrate adaptativo; renovação de URL após expiração.

### Option B: HLS com múltiplas resoluções
**Pros:** adaptação de rede. **Cons:** transcodificação, playlists, segmentos e
autorização mais complexas; não exigido pela fase.

**Recommendation:** A — endpoints estáveis autenticados redirecionam com 307
para GET pré-assinado por 15min, `Cache-Control: no-store`. Stream usa derivado
faststart com `Content-Type: video/mp4` e disposition inline. Download usa original
com disposition attachment e filename sanitizado. MinIO responde 200/206/416;
testar redirects, Range e HEAD efetivos. Um cliente solicita nova URL estável
quando a assinatura expira; expiração recusa novas requisições, sem promessa de
interromper download já iniciado. Não persistir nem logar query strings assinadas.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** @aws-sdk/s3-request-presigner@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: Expiração vale para novas requisições, sem cancelamento prometido de download em curso.


## TD-06: Estados e confiabilidade entre banco, storage e fila

**Scope:** Backend
**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

### Option A: Estado no PostgreSQL e outbox transacional
**Pros:** upload finalizado não perde processamento durante queda do Redis;
recuperação explícita após crash. **Cons:** tabela/dispatcher/reconciliação extra.

### Option B: Completar storage e publicar diretamente na fila
**Pros:** menos código inicial. **Cons:** crash entre persistência e publish perde
job; exige reconciliação equivalente para atender confiabilidade.

**Recommendation:** A — `draft → processing → ready|error`. Criar draft antes
de chamar MinIO; sessão separada `initiating|uploading|completing|completed|aborted|expired`.
Complete é idempotente: reservar transição com compare-and-set; reconciliar
`completing` por HEAD se houver crash após CompleteMultipartUpload. Transação
persiste processing + outbox; dispatcher publica at-least-once com jobId estável
`video-{uuid}-v1`. Worker só passa a ready após confirmar ambos os derivados.

Três tentativas transitórias, backoff exponencial começando em 5s. Conteúdo inválido
é erro definitivo sem retry; Redis indisponível deixa evento persistido. Lease
com fencing token no banco impede tentativa antiga de sobrescrever a nova;
artefatos por tentativa evitam sobrescrita no storage. Reconciliador verifica
processing sem job/lease válido e outbox não finalizada; stalled ou job terminal
no Redis é recuperado enquanto houver orçamento DB. Apenas falha definitiva ou
orçamento DB esgotado com lease ausente/expirada termina em error. Reentrega de
ready/error é no-op.
Na fase, erro terminal exige novo upload; retry manual de vídeo fica fora do escopo.
Abort/expiry mantém draft para futura edição e fecha sessão; não cria quinto
status público. Limpeza imediata de recursos descartáveis ao terminalizar;
fallback para órfãos abandonados há 24h, preservando leases e referências vencedoras.

Completion aceito por CAS antes de expires_at grava completion_started_at e tem
precedência sobre sweep de expiração; completed retorna replay 202 mesmo após TTL.
Lease de operação 120s renovada a cada 20s durante I/O não renova TTL de upload.
Ao devolver uploading por partes incompletas, limpar completion_started_at; novo
CAS antes do TTL inicia novo ciclo, recuperação do mesmo ciclo não renova o aceite.
Recuperação sem objeto mas com multipart repete sequência/quantidade/tamanhos/total
antes de CompleteMultipartUpload. Incompleto retorna uploading/409 se no prazo;
depois do prazo, expired/410 e limpeza. Tamanho divergente aborta/422, sem job.
Expiração direta só afeta initiating/uploading; completing fica reservado até
reconciliação. Replays POST em initiating retornam 200 com upload.state e
lastErrorCode, Retry-After:5 e polling; não duplicam provisioning ativo.
CAS sem atualização ou resposta de commit perdida exige reler status/attemptId/keys:
objetos já referenciados por ready são sucesso idempotente, nunca lixo. DB
indisponível adia exclusão. Todos esses casos exigem failpoints específicos.

Idempotência: title NFC+trim; filename NFC, barras normalizadas, basename, remoção
de controles U+0000..001F/U+007F e trim, rejeitando vazio/'.'/'..'. Validar limites
em pontos de código após normalizar. Hash SHA-256 hex de UTF-8 JSON.stringify do
array [titleNormalizado,filenameNormalizado,sizeBytes,contentType], sem coerção,
contentType exatamente video/mp4; UUID da key em minúsculas. Sessão completed não
expira no replay; aborted/expired exige nova key para outro upload. Schema exige
state/expected_parts NOT NULL e FK composta (video_id,channel_id) para o vídeo.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** bullmq@5.81.5 (TypeORM/PostgreSQL herdados)

**Revisions:**
- 2026-11-06 — Resolve AMB-1: heartbeat 20s, lease 120s usando relógio PostgreSQL,
  sweep 30s e dispatcher 5s. Incrementar attempts no claim atômico; limite 3 no
  banco continua válido mesmo se Redis perder jobs. Stalled pode repetir enquanto
   há orçamento; exhausted encerra error. Publicação de outbox tenta novamente
  indefinidamente com backoff até 5min durante indisponibilidade de infraestrutura.
- 2026-11-06 — Resolve AMB-1: POST inicial exige Idempotency-Key UUID persistida
  com hash do request e UNIQUE(channel_id, idempotency_key); retry com mesmo
  payload retorna mesmo vídeo. CreateMultipartUpload falho mantém initiating
  recuperável; reconciliar após 120s, listar uploads apenas para a key gerada,
  abortar órfãos e iniciar uma sessão única. Em completing, HEAD positivo e tamanho
   correto confirma; HEAD ausente com multipart existente retenta Complete usando
   ListParts; ambos ausentes fecha sessão aborted com erro persistido, sem enfileirar.
  Não manter transação PostgreSQL aberta durante chamada de rede.

- 2026-11-07 — Resolve AMB-2: claim recusado por lease ativa/backoff não é sucesso
  nem consome tentativa DB; adiar a entrega sem ACK terminal. Falha transitória
  do detentor libera lease por CAS e grava processing_next_attempt_at (5s, 10s).
  Crash conserva lease até expirar; o reconciliador respeita backoff persistido.
  Job failed/completed sem vídeo terminal e com orçamento DB restante deve ser
  reativado/republicado de forma serializada; contador BullMQ não encerra vídeo
  sozinho. Esgotamento DB só vira error após lease ausente/expirada, nunca enquanto
  a terceira tentativa válida ainda executa. Fencing protege todas as transições.

- 2026-11-07 — Revisão detalhada: a Recommendation consolidada acima substitui
  as instruções históricas de recuperação/cleanup: revalidar partes, proteger
  completing aceito antes do TTL e reler commit desconhecido antes de excluir.
  Normalização e replay concorrente têm contrato explícito; state/expected_parts
  são obrigatórios e FK composta preserva o dono. Registros anteriores permanecem
  históricos, sem precedência sobre a Recommendation vigente.
- 2026-11-09 — Remediação A08–A10: initiating/completing e cleanup terminal
  exigem claim renovável com token/fencing, varredura paginada por key exclusiva,
  decisão explícita de todos os estados remotos e liberação de quota uma vez
  somente após ausência remota confirmada. Indisponibilidade permanece recuperável.

## TD-07: URL única e identidade

**Scope:** Backend
**Capability:** URL única por vídeo, sem conflito com outros vídeos

### Option A: Token aleatório curto e índice único
**Pros:** não revela sequência nem depende do título, URL estável. **Cons:**
requer tratar violação de unicidade mesmo com colisão improvável.

### Option B: UUID textual na URL
**Pros:** reutiliza a PK. **Cons:** URL mais longa para a exigência de URL curta.

**Recommendation:** A — `randomBytes(16).toString('base64url')` (22 caracteres),
coluna `public_id` com UNIQUE; retry de geração até 3 vezes em transações novas
(ou savepoint), retornando erro 503 se esgotar. PK UUID separada. URL canônica
`{API_PUBLIC_URL}/videos/{publicId}`; não promete página `/watch` inexistente.
Token é identidade, não credencial de acesso.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** node:crypto

## TD-08: Autorização e fronteira com publicação

**Scope:** Backend
**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

### Option A: Acesso do dono na fase de upload
**Pros:** rascunhos continuam privados; publicação fica na Fase 04. **Cons:**
preview/download exige token do dono nesta fase.

### Option B: Todo ready fica público automaticamente
**Pros:** facilita reprodução anônima imediata. **Cons:** confunde processamento
com publicação e expõe conteúdo antes da decisão do autor.

**Recommendation:** A — todas as rotas de vídeos exigem JWT válido e canal
vinculado ao `sub`; autor derive do banco, nunca do body. Para recurso de outro
dono retornar 404. Estado ready não publica. Acesso anônimo será tratado com
publicação nas fases posteriores. URL assinada é credencial temporária: quem a
receber poderá usá-la até expirar. Não implementar UI/BFF; clientes de teste podem
chamar backend diretamente. A futura UI preservará BFF para controle e enviará
bytes diretamente ao storage, sem proxy de 10GB no BFF.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** —

## TD-09: Operação, limites e evidências

**Scope:** Repo-wide
**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

### Option A: Compose real com testes pequenos e ensaio grande separado
**Pros:** testes regulares rápidos e comprovação real de 10GB. **Cons:** ensaio
grande requer espaço, tempo e relatório próprio.

### Option B: Todos os testes executam upload de 10GB
**Pros:** limite exercitado sempre. **Cons:** torna cada ciclo de desenvolvimento
caro e lento sem aumentar a cobertura das regras unitárias.

**Recommendation:** A — Compose com API em execução, migration/init one-shot,
PostgreSQL, Mailpit, MinIO, Redis e worker; named volumes e healthchecks. Imagens
sem `latest`, lockfile e dependências exatas. MinIO OSS está arquivado: manter a
restrição do desafio e construir a partir do release
`RELEASE.2025-10-15T17-29-55Z`/commit fixado (sem depender de imagem pública
descontinuada); registrar risco e não alegar adequação de produção.

Antes do baseline, preparar instância PostgreSQL descartável em stack própria,
sem volumes/conexões dev, DB_HOST de teste, DB_NAME e DB_DATABASE iguais,
credencial restrita, e verificar destino/current_database() no helper e AppModule;
sem fallback dev. SI-03.2 acrescenta isolamento storage/fila. Autofix lint precede
congelamento da árvore; quatro gates finais usam lint -- --no-fix e fingerprint
antes/depois (inclui arquivos novos), repetindo checks afetados se houver mudança.

Testes normais exercitam bytes reais, PostgreSQL/Redis/MinIO/FFmpeg e falhas. Fixture
de retomada >64MiB, pelo menos duas partes; quota global usa pelo menos seis canais.
POST /videos com segundo usuário cria no canal dele; 404 aplica-se ao acesso a
recurso alheio. Ensaios grandes separados: MP4 válido exatamente 10GB (free permitido)
e MP4 representativo com ≥9GB de payload audiovisual de pacotes e ≤10GB totais,
sem padding para o mínimo. Transferir/processar ambos, interromper/retomar, medir
fonte/derivado/duração/picos de disco e hashes. Reportar API continuamente de upload
até ready/error, com métricas separadas por etapa: cada uma deve cumprir p95 ≤500ms
e ≤2x baseline, erro <1%, RSS ≤baseline+128MiB. Renovar access token antes de 15min
via refresh rotation e testar retomada após expiração; não aumentar TTL para o
ensaio. Não usar arquivo esparso/mock como prova de transferência nem padding como
evidência de processamento representativo; não extrapolar para todos os perfis.

Reserva de admissão cobre upload, processing e cleanup pendente: 2/canal e 10
globais, sob advisory transaction lock, contados por quota_released_at IS NULL.
Liberação persistida só após estado terminal e limpeza confirmada de recursos
descartáveis; fonte completed e derivados vencedores continuam retidos. Falha de
cleanup retém reserva, é observável e reconciliada. Replay não consome nova reserva.
**Decision:** A — escolha técnica da proposta; revisão do usuário pendente.
**Libraries:** —

**Revisions:**
- 2026-11-06 — Resolve IC-1/AMB-1: overrides nas rotas de vídeo: criação 10/min,
  assinatura 60/min (até 20 partes por request), polling/consulta 120/min,
  conclusão/abort 20/min, mídia 60/min por IP/rota usando throttler herdado. Auth
   mantém seus limites. No máximo 2 uploads ativos por canal e 10 globais; reserva
   atômica em PostgreSQL (advisory transaction lock) e liberação na conclusão,
   abort ou expiração. JSON limitado a 64KiB apenas no controle de vídeo.
- 2026-11-06 — Resolve DG-1: banco e bucket/prefixo Redis de testes separados,
   helpers usam DB_NAME=test dedicado, cleanup respeita FKs, migrations testadas
  do zero e rollback só da nova migration. Relação Video→Channel unidirecional.

- 2026-11-07 — Revisão detalhada: Recommendation vigente substitui liberação de
  quota na conclusão por terminal + cleanup, e antecipa isolamento DB_NAME e
  DB_DATABASE ao baseline. Define dois ensaios, métricas por etapa, refresh JWT
  e gates sem escrita. As entradas de 2026-11-06 acima são histórico supersedido.
- 2026-11-09 — Remediação A16/A18: a proteção permanente exige validação
  central antes de efeitos destrutivos, confirmação de `current_database()` e
  migrations sem `synchronize`; o primeiro boot instala dependências em container
  antes de migrations/storage-init/API e deve repetir idempotentemente em volumes
  e projeto Compose isolados.

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
| --- | --- | --- | --- | --- |
| TD-01 | Backend | Fila | BullMQ 5 + Redis | A (proposta) |
| TD-02 | Backend | Upload | Multipart direto retomável | A (proposta) |
| TD-03 | Backend | Storage | Bucket privado e prefixos | A (proposta) |
| TD-04 | Backend | Processamento | MP4 restrito, remux e JPEG | A (proposta) |
| TD-05 | Backend | Streaming | Range e URL pré-assinada | A (proposta) |
| TD-06 | Backend | Estados | Outbox, retries e fencing | A (proposta) |
| TD-07 | Backend | URL | Token 128 bits com UNIQUE | A (proposta) |
| TD-08 | Backend | Acesso | Dono; publicação posterior | A (proposta) |
| TD-09 | Repo-wide | Evidência | Infra real + ensaio 10GB | A (proposta) |

## Referências consultadas

- [BullMQ: produção](https://docs.bullmq.io/guide/going-to-production),
  [retry](https://docs.bullmq.io/guide/retrying-failing-jobs) e
  [job IDs](https://docs.bullmq.io/guide/jobs/job-ids).
- [NestJS: filas](https://docs.nestjs.com/techniques/queues).
- [SDK S3 v3](https://github.com/aws/aws-sdk-js-v3),
  [limites multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html),
  [GetObject/Range](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
- [ffprobe](https://github.com/FFmpeg/FFmpeg/blob/master/doc/ffprobe.texi),
  [MP4 faststart](https://github.com/FFmpeg/FFmpeg/blob/master/doc/muxers.texi).
- [Estado do MinIO OSS](https://github.com/minio/minio) e
  [release fixado](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).

Consulta de APIs via Context7 e confirmação de versões no registry npm em
2026-11-06. Detalhes e limites da verificação em `library-refs.md` da fase.

## Revisão de remediação — auditoria de 2026-11-16

Esta revisão é aditiva e prevalece quando houver conflito com o fechamento
histórico de 16/11. Ela não muda a stack nem invalida medições anteriores; reabre
o aceite até que as correções e provas abaixo sejam executadas no novo candidato.

- **TD-02/TD-06 — provisionamento e prazo:** toda adoção/finalização de multipart
  exige CAS de estado, token, lease e prazo pelo relógio do banco. HTTP e
  reconciler usam a mesma descoberta paginada por key exata, adotam um candidato
  determinístico e registram cleanup dos excedentes e efeitos tardios.
- **TD-03/TD-04 — I/O e processamento:** download/upload usam cadeia supervisionada
  e cancelável; `@aws-sdk/lib-storage` fixa `partSize=64MiB` e `queueSize=2`.
  Um AbortSignal comum cobre deadline total, perda de lease, subprocessos, HEAD e
  CAS ready. FFmpeg/ffprobe aceitam somente arquivos/protocolos locais; conteúdo
  inválido, codec não suportado e falha transitória têm classificações distintas.
- **TD-06/TD-09 — cleanup e outbox:** obrigação durável e paginada de cleanup
  sobrevive à liberação histórica de quota e alcança todos os attempts/scratch e
  multiparts tardios, preservando original completed e derivados vencedores.
  Nova liberação ocorre uma vez, após limpeza comprovada. Backoff limita o
  expoente e o contador antes da aritmética de intervalo.
- **TD-02/TD-05/TD-07 — HTTP e contrato:** parser de vídeo limita JSON
  descomprimido a 65.536 bytes antes do parser genérico; MIME inválido é 415,
  campos extras em completion são 400, parte ausente é 409 e tamanho divergente
  é 422. Respostas com URLs são `no-store`; sessão permanece 24h e assinatura
  positiva no máximo 900s. `canonicalUrl` usa `API_PUBLIC_URL`, nunca `Host`.
- **TD-03/TD-09 — bootstrap e segurança:** MinIO e AWS têm branches explícitos;
  bucket existente é revalidado sem apagar política externa desconhecida. Testes
  destrutivos exigem host explícito, banco/usuário efetivos e role sem privilégios
  administrativos. Readiness do worker depende de consumidor/heartbeat, e logs
  usam contexto sanitizado central.
- **TD-09 — evidência e entrega:** os dois ensaios grandes rodam no perfil padrão
  2 CPUs/1GiB e usam expiração natural do access token emitido pelo login, com
  refresh rotation. O candidato final é identificado por manifesto SHA-256
  antes/depois de todos os gates. Commit, merge e push continuam condicionados a
  autorização explícita posterior e seguem feature→dev, nunca commit direto main.

Rastreabilidade completa da revisão: A01/A05/A07 → TD-02/06; A02/A03/A11 e N03
→ TD-03/04/06; A04/A10 → TD-06/09; A06/A08 e N01/N02 → TD-02/05/07; A09/A16 e
N06/N07/N08 → TD-03/09; A12–A15/A17 e N04/N05/N09 → TD-09. A validação canônica
da fase mantém a matriz individual de todos os 26 itens.
