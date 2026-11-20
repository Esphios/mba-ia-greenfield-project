# Evidência da remediação — 2026-11-18

## Stack standalone (SI-03.34)

Executado a partir de `nestjs-project/`:

```text
docker compose -f compose.test.yaml --profile worker config --services
docker compose -f compose.test.yaml --profile worker down -v --remove-orphans
docker compose -f compose.test.yaml --profile worker up -d --build
docker compose -f compose.test.yaml --profile worker ps -a
```

Serviços resolvidos: `dependencies-test`, `minio-test`, `storage-init-test`,
`db-test`, `mailpit-test`, `migrations-test`, `redis-test`, `nestjs-api-test` e
`video-worker-test`. A stack foi removida com volumes antes da subida. Consultas
por label retornaram zero containers e zero volumes do projeto Compose de
desenvolvimento `streamtube`.

Após a reconstrução, PostgreSQL, Redis, MinIO, Mailpit e worker ficaram
`healthy`. `dependencies-test`, `storage-init-test` e `migrations-test`
terminaram com exit 0. A API efetiva expôs:

```text
DB_USERNAME=streamtube_phase03_test
DB_NAME=streamtube_phase03_test
VIDEO_QUEUE_PREFIX=streamtube_phase03_test
```

Uma consulta após `SET ROLE streamtube_phase03_test` retornou
`streamtube_phase03_test|streamtube_phase03_test` para usuário e banco atuais.
Nenhuma credencial foi registrada.

## Regressões direcionadas F05–F07

Cinco suites de integração em processo serial — cleanup obligation/coordinator,
upload reconciler/service e processing recovery — terminaram com exit 0: 5
suites, 52 testes passados. Elas cobrem quota até confirmação, efeitos tardios,
scratch, lease/CAS e corrida de adoção. Uma seleção e2e adicional contra
PostgreSQL e MinIO reais executou, sem reutilizar contagens históricas, os casos
de cleanup de processing/abort, reserva expirada com storage indisponível e
create multipart aceito com resposta perdida: 3 passados, exit 0 (31 casos não
selecionados pelo filtro, que serão executados na suite integral).

## Regressões direcionadas F08–F12

- Config/TTL, deadline S3, paginação/sinais e CAS do repositório: 4 suites, 28
  testes passados, exit 0.
- Swagger runtime habilitado/desabilitado: 6 testes passados, exit 0.
- JSON estrito, limites comprimidos, MIME, clock do banco, expiry, completion
  protegida e recovery pós-CAS: 7 cenários e2e passados, exit 0.
- Auditoria do documento OpenAPI das 12 operações: 1 cenário passado, exit 0.
- O endpoint HTTP pendente foi cancelado e teve o request fechado em 240 ms
  (assertion de orçamento <1.000 ms); item posterior e ciclo posterior de
  maintenance também executaram.

Assim, F08 tem clock/CAS/recovery; F09 tem TTL e boundaries; F10 tem documento
e security/schema/headers; F11 tem matriz JSON; F12 tem handler, sinais,
paginação e servidor pendente. Não ficou limitação funcional nesses cenários;
as suites integrais continuam como gate separado em 7.5.

## Regressões direcionadas N02–N08

Seis suites (readiness, runtime maintenance, policy, logging, módulo de vídeos e
configuração) passaram 27 testes, exit 0. O render combinado de
`compose.test.yaml` + `compose.large.yaml` passou sem `cpuset`, mantendo worker
em 2 CPUs/1 GiB. Em teste Compose real, parar Redis tornou o worker `unhealthy`;
reiniciar Redis restaurou Redis e worker para `healthy`.

A matriz de policy recusou `s3:GetObject`, `s3:Get*`, `s3:*` e `*`, preservando
policy privada/condicional. Capturas de reconciler/outbox não continham token,
credencial, query `X-Amz` nem stderr. A suite e2e com
`API_PUBLIC_URL=http://localhost:4317` passou 34 testes e uma instância efêmera
respondeu ao host nessa porta (404 esperado para a rota-probe), provando URL
pública alcançável sem DNS interno. A cobertura usa fronteiras públicas; o teste
redundante do controller e casts dos métodos privados afetados foram removidos.

## Gates integrais — primeira passagem

Todos os comandos usaram `--runInBand` e exit 0:

| Gate | Suites | Passados | Skipped esperado |
|---|---:|---:|---:|
| Jest padrão | 47 | 316 | 14 do perfil FFmpeg |
| e2e padrão | 5 | 92 | 2 do perfil worker |
| `VIDEO_WORKER_INTEGRATION=1` no container worker | 1 | 14 | 0 |
| `VIDEO_WORKER_E2E=1` com worker/fila reais | 1 | 2 | 0 |

As contagens são desta execução e diferem das baselines históricas 274/91/14/2.
Os dois perfis condicionais mostram os casos nominalmente executados, não
apenas suites descobertas/skipped.

## Verificação estática

No container `nestjs-api-test`, `npx tsc --noEmit`,
`npm run lint -- --no-fix` e `git diff --check` terminaram com exit 0. O lint
reportou 48 warnings preexistentes e nenhum erro. A comparação exata de
`git status --porcelain=v1 -uall` antes e depois confirmou que os comandos não
alteraram a árvore de trabalho.

## Ensaios grandes correntes — SI-03.35

Os ensaios de fronteira (10.000.000.000 bytes) e de mídia representativa
(9.104.679.495 bytes) chegaram a `ready` com hashes, metadata, thumbnail,
stream/download, Range e HEAD verificados. A probe independente permaneceu
abaixo de 500 ms, de 2× o baseline e sem erros nas janelas de atividade. Uso de
API/worker, MinIO, scratch e event loop está publicado em
[`large-trials.md`](large-trials.md); tentativas reprovadas ou interrompidas
foram preservadas sem substituir os resultados aprovados.

A certificação final de SI-03.36 permanece separada: secret scan, manifesto do
candidato congelado, repetição dos quatro gates e verificação byte a byte ainda
devem ocorrer sobre a mesma árvore.
