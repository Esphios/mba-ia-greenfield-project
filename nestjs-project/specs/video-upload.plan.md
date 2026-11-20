---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/video-upload.e2e-spec.ts
---

# Video Upload Test Plan

## Application Overview

Contrato HTTP de criação, controle e autorização de uploads multipart. Os 23
passos abaixo foram exercitados por 31 testes e2e em 2026-11-10, com aplicação
Nest completa, PostgreSQL, MinIO e Redis reais. A correspondência pública entre
achados e testes está em
`docs/phases/phase-03-videos/evidence/failpoint-matrix.md`. A suíte focal passou
31/31, sem skipped; a suíte e2e completa passou 83/83.

O mapa vigente não depende desse artefato histórico: os contratos executáveis
estão em `test/video-upload.e2e-spec.ts`, com persistência/concorrência em
`src/videos/video-upload.service.integration-spec.ts` e recuperação em
`src/videos/upload-reconciler.integration-spec.ts`.

### Regressões da auditoria de 16/11

| Contrato | Caminho executável |
| --- | --- |
| role DB restrita e recusas pré-limpeza | `test/support/video-upload-e2e-harness.ts`, `src/test/test-database-safety.spec.ts` |
| initiating, resposta perdida, adoção e fencing | `src/videos/upload-reconciler.integration-spec.ts`, `src/videos/video-upload.service.integration-spec.ts` |
| obrigação durável de cleanup/quota | `src/videos/cleanup-obligation.repository.integration-spec.ts` |
| parser 64 KiB/MIME/compressão e completion vazio | `test/video-upload.e2e-spec.ts`, `src/videos/videos.controller.spec.ts` |
| expiração, 409/422 e no-store | `test/video-upload.e2e-spec.ts`, `src/videos/video-upload.service.integration-spec.ts` |

As asserções observam HTTP, DB e storage; não acessam membros privados do
controller/service para inferir resultado.

### Remediação corrente de 18–20/11

Cleanup/quota, provisioning, relógio/CAS/TTL, JSON/OpenAPI e deadlines foram
reexercitados no Compose standalone. A primeira passagem integral executou
316 testes padrão e 92 e2e; os ensaios de fronteira e mídia representativa
validaram expiração natural, refresh rotation e retomada. Contagens e limitações
estão em `docs/phases/phase-03-videos/evidence/remediation-2026-11-18.md` e
`docs/phases/phase-03-videos/evidence/large-trials.md`; a certificação local do
candidato integrado e congelado repetiu os mesmos gates, com publicação pendente.

## Test Scenarios

### 1. POST /videos e operações de upload

**Setup:** Nest completo, PostgreSQL/MinIO/Redis de teste reais; pelo menos seis
usuários confirmados com JWT/canais diferentes. DB_NAME=DB_DATABASE descartável,
current_database() verificado no helper/AppModule antes de DELETE/DROP e credencial
sem acesso dev. O consumidor permanece parado: esta spec comprova somente o plano
de controle até `processing`. MP4 válido >64MiB (pelo menos duas partes) para
retomada e fixtures menores para os demais casos. Sem mocks S3; limpar apenas
namespaces de teste.

#### 1.1. draft-idempotencia-e-retomada

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Chamar POST /videos com Idempotency-Key e payload válido.
   - expect: 201/Location, draft ligado ao canal; provisioning ocorreu depois do insert.
2. Repetir mesmo body/key e depois alterar title mantendo a key.
   - expect: 200 mesmo id, depois 409 IDEMPOTENCY_CONFLICT.
3. Assinar partes, enviar algumas direto ao MinIO e interromper cliente.
   - expect: GET upload lista apenas partes recebidas; novas URLs retomam faltantes.
4. Concluir antes de todas as partes e depois concluir com todas.
   - expect: 409 UPLOAD_INCOMPLETE; depois 202 processing e um único evento lógico.
5. Repetir completion.
   - expect: 202 sem outro vídeo/job lógico.

#### 1.2. autorizacao-validacao-quotas

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Repetir todas as rotas sem JWT; nas rotas de recurso existente usar JWT alheio.
   - expect: 401 e 404, respectivamente; nenhuma URL, key ou metadado privado.
   Chamar POST /videos com segundo usuário, payload/key novos e quota disponível.
   - expect: 201 no canal desse usuário, sem associação ao canal do primeiro.
2. Enviar campo extra channelId/key, size negativo, size >10GB e MIME incompatível.
   - expect: 400, 413 ou 415 conforme catálogo, sem iniciar multipart.
3. Exceder 2/canal; depois preencher 10 reservas em cinco canais e solicitar no sexto.
   - expect: 429 UPLOAD_QUOTA_EXCEEDED também no sexto abaixo da quota individual;
     repetição concorrente não ultrapassa limites nem atribui a falha ao throttle.
   Concluir uploads mantendo worker parado; abortar outro com cleanup indisponível.
   - expect: processing e cleanup pendente ainda contam reserva; liberar uma vez
     só após terminal e limpeza confirmada, preservando originais retidos.
4. Exceder limite de body JSON e limites por rota sem alterar auth.
   - expect: 413 BODY_TOO_LARGE e 429 com Retry-After; auth mantém contrato anterior.

#### 1.3. assinatura-expiracao-abort

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Tentar PUT de parte maior que signed Content-Length no MinIO real.
   - expect: rejeição sem fechar sessão; reenviar parte correta e completar com
     demais partes corretas permite processamento.
2. Expirar assinatura com TTL curto de configuração exclusiva do teste; renovar.
   - expect: URL antiga falha, nova funciona dentro da sessão ainda válida.
3. Expirar sessão no banco de teste e chamar assinatura/conclusão.
   - expect: 410; limpeza eventual de multipart; draft preservado.
4. Abortar sessão ativa duas vezes e tentar abort durante completing/completed.
   - expect: 204 idempotente para aborted, 409 para operação incompatível.
5. Assinar quando restam 60s, depois quando prazo não é positivo.
   - expect: expiresAt/TTL não ultrapassam a sessão (arredondamento para baixo);
     segundo caso 410. completing recusa assinatura sem renovar TTL.
6. Aceitar completion antes de expires_at, atrasar resposta S3 além do prazo e executar sweep.
   - expect: completing protegido; objeto validado avança processing e replay
     completed após TTL continua 202. Sessão uploading vencida retorna 410.
7. Derrubar processo após CAS completing antes de validar multipart incompleto;
   executar recuperação antes e depois do prazo, em sessões independentes.
   - expect: nenhuma conclusão parcial no storage; uploading/409 preserva partes
     antes do prazo, expired/410 limpa depois. Tamanho divergente aborta/422 sem job.

#### 1.4. normalizacao-replay-e-refresh

**Covers AC:** #1, #2
**Source:** review-2026-11-09
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Usar título NFC/NFD equivalente, espaços de borda e filenames com caminhos/controles.
   - expect: normalização canônica e hash idênticos para conteúdo normalizado igual;
     caixa/espaços internos distintos geram 409 com a mesma key. Validar limites em
     pontos de código, nome vazio/ponto e proibir coerção de sizeBytes/campos extras.
2. Suspender provisioning após draft e fazer replay concorrente ou após 503.
   - expect: 200 com schema completo, initiating/lastErrorCode e Retry-After:5;
     polling retorna lista vazia até uploading; um único provisioning com lease válida.
3. Repetir criação de sessão completed após expires_at e de sessão expired.
   - expect: estados reais preservados; completed não vira expired; novo upload
     exige nova key e não substitui silenciosamente draft anterior.
4. Expirar access token, confirmar 401 e renovar via /auth/refresh com rotation.
   - expect: retoma o mesmo publicId/key e só partes faltantes, sem alterar TTL auth/upload.
5. Executar init/preflight MinIO duas vezes com origens permitida/proibida.
   - expect: bucket privado, CORS global efetivo, headers expostos e nenhum
     PutBucketCors. Estratégia aws tem teste próprio de configuração por bucket;
     teste apenas MinIO não autoriza alegar integração AWS exercitada.

#### 1.5. openapi-sem-side-effects

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Exportar documento com schema da API usando infraestrutura de teste.
   - expect: requests, responses, erros e bearer auth documentados.
2. Comparar fila/outbox antes e depois da exportação.
   - expect: nenhum job consumido nem manutenção executada pelo export.
