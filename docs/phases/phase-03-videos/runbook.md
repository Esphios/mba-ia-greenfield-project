# Operação de vídeos — Fase 03

## Inicialização

Na pasta `nestjs-project/`, `docker compose up -d --build` inicia banco, Redis e
MinIO; os jobs `dependencies`, `migrations` e `storage-init` precisam terminar
com exit 0 antes da API e do worker. `docker compose ps` deve mostrar MinIO e
worker como `healthy`; apenas `Up` não comprova prontidão.
O worker executa `node dist/video-worker`, verifica FFmpeg/ffprobe e recusa
readiness se o scratch tiver menos de 40 GiB livres. Dentro dos containers,
PostgreSQL é `db`, Redis é `redis` e storage é `minio`. `S3_PUBLIC_ENDPOINT`
precisa ser alcançável pelo cliente que usará a URL assinada.

O worker standalone usa BullMQ diretamente, sem integração `@nestjs/bullmq`.
PostgreSQL/outbox é a intenção durável; Redis é transporte. O arquivo de
readiness só nasce após conexão do consumidor e recebe heartbeat a cada 10 s.
MinIO é verificado por `/minio/health/ready`. O bootstrap de storage revalida
bucket existente e recusa política que permita leitura anônima; CORS via SDK é
aplicado somente no backend AWS, enquanto MinIO recebe CORS pela stack.

O avaliador local de policy é deliberadamente limitado: recusa `Allow`
incondicional com principal público e ações que casam `s3:GetObject` (incluindo
`*`, `s3:*` e `s3:Get*`). Ele não é um simulador IAM completo para `NotAction`,
combinação entre statements, SCP/ACL ou semântica de condições. Policies
condicionais não são classificadas como públicas por esse preflight e precisam
de revisão IAM externa antes de produção.

## Capacidade e retenção

`minio-data` guarda a fonte original e os derivados dos vídeos prontos;
`worker-scratch` é temporário e separado. Planeje capacidade para as fontes
retidas e para MP4/JPEG derivados no MinIO, além de pelo menos 40 GiB livres no
scratch por worker na configuração atual. O worker faz streaming da fonte para
o scratch, valida todas as tracks, gera MP4 faststart e JPEG, publica ambos e
só então confirma `ready`. A fonte de um vídeo `error` ou `ready` permanece no
storage; não há política automática de exclusão histórica nesta fase. Backups
e retenção devem tratar o banco e `minio-data` como um conjunto. Não apague
manualmente objetos referenciados por `videos`.

O perfil aceito é estrito: container MP4, exatamente uma faixa de vídeo H.264
`yuv420p`, zero ou uma faixa de áudio AAC, sem tracks extras, e eixos limitados
respectivamente a largura 3840 e altura 2160. A regra não gira os eixos: um
portrait com altura acima de 2160 é rejeitado. O teto de 10.000.000.000 bytes
limita transporte/storage; não amplia esse perfil de mídia.

## Recuperação e alertas

Outbox e leases em PostgreSQL são a intenção durável. O worker despacha a cada
5 s e reconcilia a cada 30 s; uma lease ativa dura 120 s e o heartbeat a estende
durante o processamento. Após três reivindicações, falha transitória vira
`error`. Uma tentativa antiga não pode publicar `ready` depois de perder a
lease. Derivados perdedores são removidos após releitura do banco; indisponibilidade
do banco adia a limpeza. Quota só é liberada após terminal e limpeza confirmada.

Monitore: falhas de readiness, espaço livre de `minio-data` e `worker-scratch`,
outbox pendente, vídeos `processing` com lease vencida, tentativas chegando a 3,
falhas de assinatura/storage, e crescimento de objetos de tentativas órfãs.
Se MinIO ou scratch se aproximar da capacidade reservada, suspenda admissão de
novos uploads no ingress/API até ampliar espaço e confirmar recuperação da fila;
não reduza `VIDEO_MAX_BYTES` como substituto de capacidade sem alterar o contrato.
Não publique URLs assinadas, tokens ou credenciais em logs e evidências.

## Validação isolada

`compose.test.yaml` usa banco descartável em tmpfs e namespaces próprios. O
ensaio de 10 GB usa `compose.large.yaml` e projeto Compose
`streamtube-phase03-large`, com MinIO em volume de disco. Arquivos de carga e
relatórios ficam separados da stack de desenvolvimento. Antes do perfil
grande, confirme no painel/runtime Docker: arquitetura Linux compatível com as
imagens fixadas (o ensaio de referência usou `linux/amd64`), pelo menos 4 CPUs
lógicas, 4 GiB de memória alocada ao Docker e 80 GiB livres no disco que
hospeda volumes e imagens. O worker continua limitado a 2 CPUs e 1 GiB; não há
afinidade com índices específicos de CPU. O orçamento de disco inclui os 40
GiB mínimos de scratch, fonte/derivados no MinIO, fixture e margem para camadas
Docker. Registre a saída deste preflight junto à evidência:

```sh
docker info --format 'arch={{.Architecture}} cpus={{.NCPU}} memory={{.MemTotal}} docker-root={{.DockerRootDir}}'
docker system df
docker compose -f compose.test.yaml -f compose.large.yaml --profile worker --profile large config
```

`docker system df` mostra consumo, não espaço livre; confira também o espaço
livre do filesystem de `DockerRootDir` com a ferramenta do host. Não execute o
ensaio se qualquer requisito estiver abaixo do mínimo ou se a arquitetura das
imagens não estiver disponível. Consulte
[`progress.md`](progress.md) antes de declarar a fase concluída: os dois ensaios
correntes comprovaram conteúdo, delivery, recursos e limites de latência com
probe independente. Os failpoints e a DoD repetida sobre o candidato integrado
estão registrados ali; somente a publicação remota via Git Flow permanece como
etapa posterior.

O harness separa baseline, PUT ativo, pausa natural do JWT, retomada,
processamento e delivery. A pausa é registrada, mas não é somada a latência de
requisição. O probe usa intervalo de 250 ms somente na janela inicial curta de
PUT, 5 s durante a pausa de expiração e 1 s no baseline, na retomada e no
processamento. A cadência preserva amostras ativas sem acionar o rate limit.
Para o ensaio local portátil, `VIDEO_LARGE_PUT_MIBPS=16` limita cada um dos
quatro streams PUT a 16 MiB/s (64 MiB/s agregados). O pacing ocorre dentro do
stream, não como espera entre partes, e o valor efetivo fica no JSON do cliente;
sem a variável, o uploader permanece ilimitado.

Comandos isolados de regressão, sempre em `nestjs-project/`. O arquivo é
standalone: não combine com `compose.yaml` e não use o perfil antigo `test`.
`migrations-test` roda automaticamente na primeira subida e após cada recriação
do banco tmpfs; o worker só existe com `--profile worker`.

```sh
docker compose -f compose.test.yaml --profile worker up -d --build
docker compose -f compose.test.yaml --profile worker ps
docker compose -f compose.test.yaml exec -T nestjs-api-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run test:e2e -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npx tsc --noEmit
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run lint -- --no-fix

docker compose -f compose.test.yaml --profile worker exec -T -e VIDEO_WORKER_INTEGRATION=1 video-worker-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T -e VIDEO_WORKER_E2E=1 nestjs-api-test npm run test:e2e -- --runInBand

docker compose -f compose.test.yaml --profile worker down -v --remove-orphans
```

As integrações FFmpeg exigem `VIDEO_WORKER_INTEGRATION=1` e executam na imagem
do worker, que contém FFmpeg; os e2e com consumidor executam na API com
`VIDEO_WORKER_E2E=1` e fila exclusiva. O MCP PostgreSQL não participa da
execução nem da evidência da fase e permanece desativado; todo acesso de teste
ocorre pela stack Compose isolada.

Após reiniciar Docker, o banco de `compose.test.yaml` perde seus dados porque
usa `tmpfs`, inclusive no projeto grande. Recrie a stack: o job
`migrations-test` executa `npm run migration:run` antes da API e do worker. O volume MinIO grande
persiste; para repetir apenas a verificação de entrega dos dois objetos já
processados, `test/support/video-large-restore.sql` reconstitui os registros
isolados que os referenciam. Esse SQL é específico para os objetos e IDs do
ensaio de novembro de 2026 e não deve ser aplicado à stack de desenvolvimento.
