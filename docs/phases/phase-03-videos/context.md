---
kind: phase
name: phase-03-videos
ui_in_scope: false
review_status: audit-2026-11-18-published
sources_mtime:
  docs/project-plan.md: "2026-11-06T21:14:04.524112+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-17T23:44:23.9433401Z"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-11-06T21:14:04.503811+00:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-11-06T21:14:04.504811+00:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-06T21:14:04.502806+00:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-11-06T21:14:04.513394+00:00"
  docs/phases/phase-02-auth/context.md: "2026-11-06T21:14:04.522099+00:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-06T21:14:04.516392+00:00"
  docs/ai/codex/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-06T21:26:45.236162+00:00"
  AGENTS.md: "2026-11-16T19:03:27.6630773Z"
  nestjs-project/AGENTS.md: "2026-11-17T19:06:46.4778233Z"
  nestjs-project/package.json: "2026-11-17T19:04:23.9333728Z"
  nestjs-project/compose.yaml: "2026-11-17T18:54:53.8073826Z"
  nestjs-project/src/channels/channels.service.ts: "2026-11-09T21:41:19.1509017Z"
  nestjs-project/src/app.module.ts: "2026-11-17T05:41:29.2453547Z"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos.

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** UI de vídeo/BFF, publicação e edição, catálogo, social, HLS,
transcodificação multicodec e deploy. A remediação atual preserva esse limite.
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo,
streaming funcionando e URLs únicas. A remediação corrente preserva o escopo
backend e revalida a implementação existente sem antecipar uma UI de vídeos.
**Affected subprojects:** `nestjs-project/` (escopo backend explicitado pelo usuário).
**Deferred subprojects:** `next-frontend/` (sem UI de vídeo nesta fase).
**Sequencing notes:** Depende das Fases 01 e 02; baseline será executada em SI-03.1.
**Neighbors (for boundary detection only):** Fase 02 auth; Fase 04 gestão/publicação.

## Decisions Index

`decided` indica escolha fechada na proposta do agente, sujeita à revisão do
usuário. Não autoriza implementação nem transforma a proposta em aceite.

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
| --- | --- | --- | --- | --- | --- | --- |
| phase-03-videos/TD-01 | phase | Backend | Fila | decided | A | bullmq@5.81.5 direto |
| phase-03-videos/TD-02 | phase | Backend | Upload | decided | A | @aws-sdk/client-s3@3.1164.0, @aws-sdk/s3-request-presigner@3.1164.0 |
| phase-03-videos/TD-03 | phase | Backend | Storage | decided | A | @aws-sdk/client-s3@3.1164.0, @aws-sdk/lib-storage@3.1164.0 |
| phase-03-videos/TD-04 | phase | Backend | Processamento | decided | A | FFmpeg/ffprobe, node:child_process, node:stream |
| phase-03-videos/TD-05 | phase | Backend | Streaming | decided | A | @aws-sdk/s3-request-presigner@3.1164.0 |
| phase-03-videos/TD-06 | phase | Backend | Confiabilidade | decided | A | bullmq@5.81.5 |
| phase-03-videos/TD-07 | phase | Backend | Identidade | decided | A | node:crypto |
| phase-03-videos/TD-08 | phase | Backend | Autorização | decided | A | — |
| phase-03-videos/TD-09 | phase | Repo-wide | Operação e evidência | decided | A | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`.
- `docs/decisions/technical-decisions-phase-01-configuracao-base.md`.
- `docs/decisions/technical-decisions-phase-02-auth.md`.
- `docs/decisions/technical-decisions-openapi-docs-nestjs.md`.
  Correlação OpenAPI incorporada por governar contratos já presentes no backend;
  decisões apenas frontend permanecem informativas, sem novos SIs de frontend.

## Capability Coverage

| Capability | TDs |
| --- | --- |
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | TD-03, TD-09 |
| Serviço de processamento em segundo plano (filas) | TD-01, TD-09 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | TD-02, TD-09 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | TD-06, TD-08 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | TD-04, TD-06 |
| Geração automática de thumbnail a partir de um frame do vídeo | TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | TD-05, TD-08 |
| Download do vídeo pelo usuário | TD-05, TD-08 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** A — BullMQ 5 direto em Redis 7.4 com AOF e `noeviction`,
worker Nest sem servidor HTTP, `concurrency=1`, separado da API. Preservar NestJS 11; não
migrar para BullMQ 6 ou NestJS 12 durante a fase.
**Libraries:** bullmq@5.81.5

### phase-03-videos/TD-02

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
**Libraries:** @aws-sdk/client-s3@3.1164.0, @aws-sdk/s3-request-presigner@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: Assinaturas limitadas pelo prazo restante; PUT rejeitado permite reenvio.

### phase-03-videos/TD-03

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
**Libraries:** @aws-sdk/client-s3@3.1164.0, @aws-sdk/lib-storage@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: CORS MinIO global separado de AWS por bucket; limites de retenção explícitos.

### phase-03-videos/TD-04

**Recommendation:** A — aceitar MIME declarado `video/mp4`; o conteúdo deve ser
MP4 com vídeo H.264, pixel format `yuv420p`, largura/altura positivas e no máximo
3840x2160, exatamente um vídeo principal não attached_pic e zero ou um áudio AAC.
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
**Libraries:** FFmpeg/ffprobe (binários do container), node:child_process, node:stream

**Revisions:**
- 2026-11-06 — Resolve AMB-1: thumbnail timeout 60s, stdout JSON do ffprobe no
  máximo 1MiB e stderr em ring buffer de 64KiB. Cada tentativa completa tem
  deadline de 90min, incluindo I/O; matar subprocessos ao perder lease.
- 2026-11-07 — Revisão detalhada: Decode integral, seleção explícita e metadata tipado dentro do deadline total.

### phase-03-videos/TD-05

**Recommendation:** A — endpoints estáveis autenticados redirecionam com 307
para GET pré-assinado por 15min, `Cache-Control: no-store`. Stream usa derivado
faststart com `Content-Type: video/mp4` e disposition inline. Download usa original
com disposition attachment e filename sanitizado. MinIO responde 200/206/416;
testar redirects, Range e HEAD efetivos. Um cliente solicita nova URL estável
quando a assinatura expira; expiração recusa novas requisições, sem promessa de
interromper download já iniciado. Não persistir nem logar query strings assinadas.
**Libraries:** @aws-sdk/s3-request-presigner@3.1164.0

**Revisions:**
- 2026-11-07 — Revisão detalhada: Expiração vale para novas requisições, sem cancelamento prometido de download em curso.

### phase-03-videos/TD-06

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

### phase-03-videos/TD-07

**Recommendation:** A — `randomBytes(16).toString('base64url')` (22 caracteres),
coluna `public_id` com UNIQUE; retry de geração até 3 vezes em transações novas
(ou savepoint), retornando erro 503 se esgotar. PK UUID separada. URL canônica
`{API_PUBLIC_URL}/videos/{publicId}`; não promete página `/watch` inexistente.
Token é identidade, não credencial de acesso.
**Libraries:** node:crypto

### phase-03-videos/TD-08

**Recommendation:** A — todas as rotas de vídeos exigem JWT válido e canal
vinculado ao `sub`; autor derive do banco, nunca do body. Para recurso de outro
dono retornar 404. Estado ready não publica. Acesso anônimo será tratado com
publicação nas fases posteriores. URL assinada é credencial temporária: quem a
receber poderá usá-la até expirar. Não implementar UI/BFF; clientes de teste podem
chamar backend diretamente. A futura UI preservará BFF para controle e enviará
bytes diretamente ao storage, sem proxy de 10GB no BFF.
**Libraries:** —

### phase-03-videos/TD-09

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

## Review Coverage

A revisão de 2026-11-07 resolve riscos de baseline destrutivo, CORS incompatível,
recuperação parcial, expiração concorrente, commit desconhecido, backlog/cleanup,
validação de mídia/seleção, métricas/fixtures, refresh JWT, testes de quota/ownership,
gates sem escrita, normalização/replay, TTL e schema. Recomendações vigentes
consolidam os contratos; Revisions preserva o histórico sem sobrepor a regra atual.
Os 25 apontamentos são rastreados em validation.md após conferência documental.
Não há mudança de runtime nem aceite de execução implícito.

## Audit 2026-11-16 Remediation Context

O fechamento de 16/11 permanece como evidência histórica do candidato auditado,
mas não é o estado corrente de aceite. A auditoria reproduziu A01–A05, identificou
A06–A17 e nove detalhes N01–N09. A change
`fix-phase-03-audit-2026-11-16` autoriza implementar as correções; publicação
remota continua fora da autorização até consentimento explícito posterior.

As decisões revisadas exigem: repositórios tipados/CAS; recuperação única de
initiating; obrigação durável de cleanup; cancelamento integral de I/O e FFmpeg;
contratos HTTP/OpenAPI fiéis; bootstrap privado MinIO/AWS; role de teste restrita;
readiness e logs sanitizados; documentação/provas atualizadas; ensaios grandes no
perfil padrão. O frontend permanece limitado à cópia OpenAPI e tipos gerados, sem
interface de vídeos. Regressões, perfis condicionais e ensaios correntes passaram;
a DoD runtime ainda depende dos gates finais sobre manifesto estável.

## Requirements Audit 2026-11-18 — Current Context

O estado corrente substitui apenas a interpretação de aceite, sem apagar o
histórico. SI-03.1–15 são a base, SI-03.16–27 registram trabalho observado em
17/11 e SI-03.28–37 estão concluídas, inclusive integração e publicação
verificada no fork. A auditoria F01–F12/N01–N12
reabriu cleanup/quota, fencing multipart, relógio/CAS/TTL, JSON/OpenAPI, deadlines
S3, readiness/portabilidade/policy/logs, perfil de mídia, ensaios e certificação.

A execução autorizada usa `compose.test.yaml` standalone e comandos
no container. `clean` continua significando somente coerência do planejamento;
não significa aprovação, implementação, teste, ensaio, DoD, commit ou publicação.
SI-03.37 recebeu as autorizações separadas para commits/reconciliação e para
push/verificação pública; `main` permaneceu intocada.

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01..04

**Recommendation:** Preservar namespaces registerAs, ConfigType/config.KEY,
validação Joi central e configuração explícita por ambiente; TypeORM com
migrations e synchronize false em runtime.
**Libraries:** @nestjs/config, joi, typeorm, pg (já existentes).

### phase-02-auth/TD-02, TD-06, TD-07, TD-08

**Recommendation:** Respeitar a escolha real de guard JWT customizado com
@nestjs/jwt, DTOs class-validator/class-transformer, erros de domínio
`{statusCode,error,message}` e throttling. O guard apenas verifica JWT e popula
`{sub,email}`: ownership precisa de consulta adicional. O throttler real é global,
10 requisições/60s; não herdar acidentalmente esse limite nas rotas de vídeo.
**Libraries:** @nestjs/jwt, class-validator, class-transformer, @nestjs/throttler.

### openapi-docs-nestjs/TD-01..03

**Recommendation:** Documentar operações/respostas com @nestjs/swagger; manter
UI e export OpenAPI e política de exposição por ambiente. Não inicializar worker
ou rotinas de reconciliação na exportação do contrato.
**Libraries:** @nestjs/swagger (existente).

## Inherited Conventions

- Configuração por namespace e Joi; migrations versionadas — Fases 01/02.
- Controllers HTTP, serviços de domínio e repositories; ChannelsService é dono
  do acesso aos canais. Atualmente só expõe createChannel; adicionar lookup
  por userId no módulo de canais, sem duplicar lógica em vídeos.
- UUID e timestamps snake_case no banco; API sem prefixo global `/api`.
- Erro de domínio tem message string; validação tem message array. 401 do guard
  usa envelope nativo Nest e não deve ser apresentado como código customizado.
- Dockerfile.dev usa `tail -f /dev/null`; Compose atual não inicia servidor.
- Test helper limpa channels/users; novas FKs exigem ordem nova. Testes de
  migration têm contagens fixas que precisarão evoluir.
- Runtime usa DB_NAME, helper usa DB_DATABASE: alinhar somente a configuração
  de teste necessária para isolamento, sem refatoração generalizada.
- Relação Video→Channel unidirecional evita exigir Video em testes antigos
  que registram conjuntos explícitos de entidades.

## Inherited Deferred Capabilities

Telas antigas de auth/landing/logout e demais interfaces são registro histórico.
Não são transferidas para os critérios desta fase backend.

## Non-UI / Deferred Capabilities

Todas as nove capacidades são backend e estão cobertas. UI, publicação, edição,
acesso anônimo a vídeos publicados e catálogo pertencem às próximas fases.

## Testing Requirements

### nestjs-project

Fonte: `docs/ai/codex/skills/testing-guide-nestjs-project/`.
Unidade testa regras e estados com colaboradores mockados; integração testa DB,
storage, fila e FFmpeg reais; e2e testa HTTP + autorização + pipeline real.
Usar `.spec.ts`, `.integration-spec.ts`, `test/*.e2e-spec.ts` e `--runInBand`.
Prever fixtures de MP4 pequeno válido/corrompido, interrupção/retomada, colisão,
Range 206/416, falhas/crashes, duplicidade de job e reentrega após lease vencida.
Ensaios separados comprovam fronteira 10GB e mídia representativa, com métricas
por etapa até terminal e refresh JWT. Regras/fixtures estão consolidadas em TD-09.
Os snapshots de 08/11 registram execuções anteriores. Os dois novos ensaios
grandes e a repetição de testes, e2e, tsc e lint sobre o candidato integrado e
congelado passaram; os manifests adjacentes registram a identidade da árvore.
