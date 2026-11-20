# SI-03.13 — matriz de failpoints (16/11/2026)

Fonte dos cenários: `nestjs-project/specs/video-processing.plan.md`. Banco,
Redis, MinIO e worker são isolados da stack de desenvolvimento.

| Cenário | Evidência executada | Lacuna |
| --- | --- | --- |
| 1.1 draft→processing→ready e regressão | `video-processing.e2e-spec.ts` 2/2; backend 228 testes e 89 e2e | nenhuma |
| 1.2 codec incompatível, tracks extras, corrupção tardia de vídeo/AAC, fps/duração inválidos, três falhas transitórias | `video-processor.integration-spec.ts` 12/12 com FFmpeg/DB/MinIO; `video-processor.service.spec.ts` 13/13 para metadados sintéticos; `processing-recovery.integration-spec.ts` | nenhuma; capa/dados e fps/duração foram injetados no resultado de probe em unidade |
| 1.3 Redis indisponível, crash S3/DB, publish/ack, kill worker, CAS, job ausente, lease/backoff, cleanup/quota | `outbox.integration-spec.ts`, `upload-reconciler.integration-spec.ts`, `processing-recovery.integration-spec.ts`; kill/heartbeat em `progress.md`; `video-redis-outage.cjs` com Redis realmente parado durante completion HTTP | nenhuma |
| 1.4 AAC/sem áudio, metadados, deadlines, órfãos | smoke FFmpeg AAC e ensaio 4K sem áudio; deadline total de teste em três tentativas no FFmpeg real, subprocesso em unidade; recuperação de órfão de 24h | nenhuma; teste do deadline usa 1 ms, sem aguardar 90 min |

Com Redis parado, completion HTTP retornou 202, `videos.status=processing` e
uma outbox com `published_at`/`finalized_at` nulos. Após reinício, o vídeo
`hKlXSIcTnOykjObDZSyXOg` chegou a `ready`, `processing_attempts=1` e a outbox
teve ambos os timestamps. O ensaio usou `video-redis-outage.cjs` no projeto
Compose isolado; exit 0. As regressões finais são registradas em `progress.md`.

## Reavaliação da change de 17/11/2026

| Auditoria | Failpoint/contrato | Evidência executável | Estado |
| --- | --- | --- | --- |
| A01/A05 | create com resposta perdida, listagem falha, replay e lease/TTL | `upload-reconciler.integration-spec.ts`, `video-upload.service.integration-spec.ts` | coberto |
| A02/A03 | I/O bloqueado, abort, lease perdida e subprocesso terminado | `video-processor.service.spec.ts`, `storage.service.integration-spec.ts` | coberto |
| A04 | terceira falha, cleanup remoto falho, PUT tardio e quota histórica | `processing-recovery.integration-spec.ts` | coberto |
| A06/A07 | fronteiras 65.535/65.536/65.537, gzip/chunked, relógio DB | `video-upload.e2e-spec.ts`, `video-upload.service.integration-spec.ts` | coberto |
| A09/N06–N08 | bucket público real, heartbeat vencido/restart, log sintético secreto | `storage.service.integration-spec.ts`, healthcheck Compose, `safe-log-context.spec.ts` | coberto; AWS real não autorizado |
| A10/A11 | contador INT_MAX, Redis outage, ENOSPC e referência externa | `outbox.integration-spec.ts`, `video-processor.integration-spec.ts` | coberto |

R01–R12 são reavaliados em `progress.md`; A13/A14 só ficam atendidos após os
gates e dois grandes ensaios do candidato atual, sem reutilizar o aceite antigo.

## Remediação corrente de 18/11/2026

| Requisito | Prova corrente | Resultado |
|---|---|---|
| F05–F07 | cleanup/late effects/quota/scratch/adoção em PostgreSQL e MinIO reais | 52 testes dirigidos + 3 e2e, exit 0 |
| F08–F12 | relógio DB, CAS, TTL, OpenAPI, JSON e endpoint S3 pendente | 28 testes dirigidos + 7 e2e + auditoria OpenAPI; cancelamento em 240 ms |
| N02–N08 | Compose portátil, URL pública, readiness Redis, policy e logs | 27 testes; Redis down/up tornou worker unhealthy/healthy; porta 4317 alcançável |
| F03/F04 | gates integrais no Compose standalone recriado | 316 padrão, 92 e2e, 14 FFmpeg e 2 worker e2e; todos exit 0 |

Os comandos, topologia e limites estão detalhados em
`remediation-2026-11-18.md`. A13/A14 foram reavaliados pelos dois ensaios
correntes de SI-03.35 e pelos artefatos de `large-trials.md`; a certificação
local do candidato congelado de SI-03.36 foi concluída, com publicação pendente.
