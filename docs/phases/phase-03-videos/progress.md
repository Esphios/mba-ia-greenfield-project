# phase-03-videos — Progress

**Status:** local_candidate_certified_publication_pending
**SIs:** SI-03.1–15 base; SI-03.16–27 históricos; SI-03.28–37 remediação atual
**Implementation:** SI-03.28–36 concluídos; SI-03.37 integrada localmente, publicação pendente

## Baseline da auditoria de requisitos — 2026-11-18

- Captura somente leitura executada antes da remediação. Branch
  `feature/phase-03-videos`; `HEAD` e merge-base com `dev`:
  `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`.
- Remotos efetivamente lidos: `origin` aponta para
  `github.com/Esphios/mba-ia-greenfield-project.git` e `upstream` para
  `github.com/devfullcycle/mba-ia-greenfield-project.git`, ambos com refs de
  fetch e push. A captura não executou fetch e, portanto, não atribui atualidade
  a refs remotas não consultadas na rede.
- Ambiente: Docker `29.9.2` (build `a82e528`), daemon `29.9.2` disponível e
  Docker Compose `v5.6.1`.
- `git status --porcelain=v1` confirmou a árvore preexistente da Fase 03: há
  alterações rastreadas em configuração, documentação, contrato e backend, e
  arquivos não rastreados em `docs/`, `nestjs-project/`, fundação Codex e
  OpenSpec. A lista integral permaneceu no log da execução; nenhum arquivo foi
  removido, restaurado, adicionado ao índice ou commitado durante a captura.
- Este baseline identifica o ponto de partida, não certifica o candidato e não
  substitui os gates nem o manifesto determinístico de SI-03.36.

## Estado corrente — auditoria de requisitos de 2026-11-18

- SI-03.1–15 são a base funcional histórica; SI-03.16–27 preservam a remediação
  executada em 17/11; SI-03.28–37 são o único conjunto corrente de trabalho.
- Resultados, contagens e ensaios anteriores continuam como evidência histórica,
  mas não fecham nenhuma unidade 28–37 nem certificam o novo candidato.
- O planejamento está `clean` somente no sentido de não conter lacuna documental.
  Implementação, regressões, ensaios, DoD, commit e publicação não são inferidos.
- Em 18/11, SI-03.28 iniciou com baseline somente leitura e correção da stack
  standalone. Commit/push continuam condicionados às autorizações de SI-03.37.

## Execução corrente — remediação de 18/11/2026

- **SI-03.28–29:** stack standalone, migrations e planejamento foram
  reconciliados. Cleanup remoto/DB e quota usam autoridade única e contratos de
  repositório; late effects, adoção, lease e concorrência foram exercitados em
  PostgreSQL e MinIO reais.
- **SI-03.30–31:** provisioning multipart é compartilhado; expiração/CAS usam o
  relógio do banco; limites JSON e DTO/OpenAPI cobrem as 12 operações. O handler
  S3 tem deadlines finitos, propaga cancelamento e preserva estados ambíguos para
  reconciliação posterior.
- **SI-03.32–33:** readiness depende de worker e Redis atuais; Compose grande é
  portátil, URL pública é pareada à porta, policies wildcard são recusadas e os
  logs operacionais são sanitizados. Perfil de mídia e referências de biblioteca
  foram corrigidos em README/runbook/decisões.
- **SI-03.34:** stack recriada desde zero; regressões dirigidas passaram 52,
  28 e 27 testes. Gates integrais passaram 316 testes padrão, 92 e2e, 14 FFmpeg
  condicionais e 2 e2e de worker condicionais. TypeScript, lint sem escrita e
  `git diff --check` terminaram com exit 0; o lint preservou os 48 warnings
  históricos e nenhuma mutação da árvore.
- **SI-03.35:** os ensaios correntes de fronteira (10.000.000.000 bytes) e de
  mídia representativa (9.104.679.495 bytes) chegaram a `ready`; hashes,
  metadata, thumbnail, delivery privado, recursos, disco e event loop foram
  verificados. A probe independente ficou abaixo de 500 ms, de 2× o baseline e
  sem erros em todas as janelas de atividade. Tentativas reprovadas ou
  interrompidas continuam preservadas e não foram reclassificadas.
- **SI-03.36:** candidato integrado certificado localmente. Secret scan e
  manifests determinísticos before/after cobrem a mesma árvore; passaram 316
  testes padrão, 92 e2e, 14 integrações FFmpeg, 2 e2e de worker, tsc e lint.
- **SI-03.37:** a autorização da tarefa 9.2 permitiu três commits focados e a
  reconciliação com `upstream/dev`, já ancestral da feature. `main` permaneceu
  intocada. Push e publicação continuam proibidos até a autorização distinta da
  tarefa 9.3.

## Snapshot histórico — remediação da auditoria de 2026-11-16

- A auditoria reproduziu cinco falhas prioritárias (A01–A05), registrou A06–A17
  e N01–N09 e concluiu que os gates verdes do candidato anterior não bastam para
  aceite integral. As evidências antigas abaixo permanecem históricas.
- O planejamento foi reaberto com SI-03.16–22. A execução de runtime ainda não foi
  comprovada nesta remediação; nenhuma contagem antiga deve ser apresentada como
  resultado futuro.
- Dependências: SI-03.16 precede persistência/provisioning; SI-03.17 precede
  cleanup/processamento; SI-03.18–20 precedem documentação/provas; SI-03.21
  precede ensaios/DoD de SI-03.22.
- A change autoriza código e validações locais. Commit, merge, push e publicação
  não foram autorizados e permanecem pendentes como gate externo.
- Rastreabilidade: A01–A17 e N01–N09 estão mapeados nas decisões revisadas, no
  plano e em `validation.md`. DoD runtime, ensaios grandes e entrega remota estão
  explicitamente pendentes.
- SI-03.16/A16 parcial concluído em 17/11: `compose.test.yaml` separa bootstrap
  admin da role da aplicação; o probe efetivo retornou banco/usuário esperados e
  `rolsuper=rolcreatedb=rolcreaterole=rolreplication=false`. Os 18 testes de
  segurança+migration passaram, incluindo up/down/reaplicação; `users` e
  `refresh_tokens` permaneceram presentes. O e2e de upload passou 31/31 com
  AppModule e auth reais; `tsc --noEmit` e lint sem autofix tiveram exit 0
  (48 warnings preexistentes/permitidos, nenhum erro).
- SI-03.16/A01/A15 concluído em 17/11: upload, reconciler, processor, recovery e
  outbox não contêm mais `DataSource`, SQL ou transações; operações tipadas/CAS
  vivem em repositórios do domínio. O teste arquitetural passou para os cinco
  serviços, `tsc --noEmit` passou, 53 regressões de persistência passaram, três
  módulos/repositórios passaram 9/9 e ownership/replay/quota concorrente HTTP
  passaram 3/3 no PostgreSQL real. `ChannelsService` continua responsável pelo
  lookup do canal.

## Baseline da retomada após SI-03.8 — 2026-11-10

- Retomada da change original: SI-03.1–8 foram reconferidos com o baseline
  executado nesta sessão (213 testes, 83 e2e, tsc/lint exit 0); as provas
  específicas estão resumidas neste registro público e na matriz de failpoints.
  Os itens 2.3–7.2 anteriormente reabertos foram fechados conforme os testes
  de integração existentes e a matriz A08–A18; SI-03.9–15 estavam pendentes
  neste ponto da retomada.
  Uma stack adicional `streamtube-phase03-fresh` com volumes novos confirmou
  `dependencies-test` e `storage-init-test` exit 0, banco/Redis/MinIO saudáveis,
  API de teste ativa e segunda execução idempotente de `storage:init` exit 0.

- Revisão de apply em 2026-11-10: `HEAD`, `dev` e merge-base permanecem em
  `8459b2f3a9c0dcad4bd0f31972761c00c52609a1` na branch
  `feature/phase-03-videos`. `git status --short` confirmou alterações locais
  rastreadas e não rastreadas da fase; foram preservadas. O baseline foi
  reconfirmado nesta revisão, sem commit ou merge.
- Isolamento SI-03.1 reconfirmado antes de migrations/testes nesta retomada:
  `compose.test.yaml` usa `db-test` com tmpfs, sem volume nem porta PostgreSQL
  publicada; `DB_NAME=DB_DATABASE=streamtube_phase03_test`, usuário restrito
  homônimo. SQL direto, `createTestDataSource` e `AppModule` retornaram
  `current_database()=streamtube_phase03_test` e
  `current_user=streamtube_phase03_test` (exit 0 nos três probes). A validação
  de teste exige alvo explícito antes de criar conexão e `cleanAllTables`
  reconfirma o banco antes de DELETE; não houve operação destrutiva nesta checagem.
- Baseline SI-03.1 da retomada: `docker compose -f compose.test.yaml up -d
  --build` concluiu com `dependencies-test` (`npm ci`) e `storage-init-test`
  exit 0; banco, Redis e MinIO saudáveis, API de teste ativa. `migration:run`
  exit 0, sem pendências. Autofix `npm run lint` exit 0 (47 warnings) ocorreu
  antes do fingerprint. Gates sem escrita: `npm test -- --runInBand --silent`
  exit 0 (37 suites/213 testes), `npm run test:e2e -- --runInBand --silent`
  exit 0 (4 suites/83 testes), `npx tsc --noEmit` exit 0 e
  `npm run lint -- --no-fix` exit 0 (47 warnings). Fingerprint SHA-256 de
  arquivos rastreados e novos não ignorados antes/depois:
  `E4AB48D622039DDEBE3C82C72180504EBE9ED26F4C80DEF4CDC4290EE6C1335F`.

- SI-03.4 e SI-03.8 estão concluídos. Os 23 passos da spec HTTP SI-03.8 foram
  mapeados para 31 testes e2e, todos aprovados com aplicação Nest, PostgreSQL,
  MinIO e Redis reais; os cenários permanecem materializados nos testes HTTP
  públicos e no histórico deste documento.
- Gates do backend: 37 suites/213 testes, 4 suites e2e/83 testes, TypeScript
  exit 0, lint exit 0 (47 warnings, nenhum erro). A07 e a tarefa 5.1 da
  remediação estão fechados.
- Esse baseline antecede a implementação SI-03.9–12 registrada abaixo.

Os registros abaixo preservam os estados e medições das rodadas anteriores.

## Estado corrente após auditoria — 2026-11-09

- A aplicação da Fase 03 foi autorizada e executada parcialmente na branch
  `feature/phase-03-videos`; os snapshots abaixo preservam essa autorização e as
  evidências observadas em 07–08/11/2026.
- A auditoria abriu a change `fix-phase-03-audit-findings`. SI-03.1–03 e
  SI-03.5–08 voltam a `pending` porque seus critérios vigentes dependem das
  correções A08–A18 e de nova execução dos gates. SI-03.4 permanece concluído:
  o adapter S3 e suas provas de integração não foram invalidados, embora seja
  reutilizado pela remediação.
- O Compose corrente declara `db`, `mailpit`, `migrations`, `minio`, `redis`,
  `storage-init`, `nestjs-api` e `video-worker`. Persistência, storage, outbox,
  upload e API existem; processamento/delivery e SI-03.9–15 continuam pendentes.
- As marcações `completed` nos snapshots datados abaixo são históricas e não
  substituem o estado corrente desta seção.

## Autorização e baseline de revisão — 2026-11-07/08

- Apply autorizado explicitamente pelo usuário para concluir o change OpenSpec
  `phase-03-videos`.
- Branch: `feature/phase-03-videos`.
- Revisão-base/HEAD inicial: `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`.
- `dev` inicial: `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`.
- Merge-base `dev...HEAD`: `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`;
  a feature foi confirmada como derivada da revisão atual de `dev`.
- O status inicial continha o port Codex, os artefatos da Fase 03 e os artefatos
  OpenSpec ainda não rastreados, além da alteração preexistente em `.gitignore`.
  Todo esse estado local deve ser preservado durante a implementação.
- Stack descartável: `compose.test.yaml`, projeto `streamtube-phase03-test`, banco
  e usuário `streamtube_phase03_test`, filesystem PostgreSQL em `tmpfs`, sem
  volume nem porta publicada do banco de desenvolvimento.
- `DB_NAME` e `DB_DATABASE` foram configurados com o mesmo nome exclusivo.
- `SELECT current_database(), current_user` confirmou
  `streamtube_phase03_test`/`streamtube_phase03_test` na conexão SQL direta, no
  helper `createTestDataSource` e na `DataSource` efetiva do `AppModule`, todos
  antes de migrations, `DELETE` ou `DROP`.

## Workflow executado

1. Port de AGENTS, 23 skills originais/recursos, 17 regras e 6 perfis auxiliares; ativação local.
2. Research: leitura da fase/código, Context7 e fontes oficiais; 9 TDs com alternativas.
3. Context: leitores auxiliares read-only e consolidação; 8 decisões candidatas, 1 da fase, 0 ad-hoc ligados a [3].
4. Validate inicial: 4 issues (AMB-1, IC-1, DG-1, OQ-1).
5. Resolve: limites/recuperação, throttle, testes e library-refs; segunda validação clean.
6. Build: Technical Specifications, 15 SIs, dependências, critérios e specs de teste planejadas.
7. OpenSpec propose: proposta, design, quatro deltas e tarefas; nenhuma execução apply.
8. Revisão final: AMB-2 resolvido (lease/backoff/orçamento DB), contratos reconciliados e fontes rastreadas. Validação estrita OpenSpec passou; conferência estática do port e dos artefatos passou.

## Ajustes da revisão — 2026-11-07

Correções documentais solicitadas pelo usuário após a revisão detalhada.
Decisões, contexto, plano, referências, specs de teste e OpenSpec são reconciliados
sem alterar runtime, dependências, migrations ou Compose. Permanecem 0/15 SIs.
Escolhas técnicas desta correção: quota cobre processing/cleanup; decode integral
dos streams selecionados; ensaios separados de fronteira e mídia representativa.
Conferência documental: 16 Markdown, 8 frontmatters YAML, links locais e
25 apontamentos rastreados em [validation.md](validation.md), sem erro estrutural
identificado. Recomendações vigentes foram sincronizadas com contexto; histórico
preservado e timestamps de origem atualizados. DoD de execução permanece pendente.
OpenSpec: openspec validate phase-03-videos --strict passou (exit 0).
Nenhum teste de aplicação, serviço, dependência, migration, commit ou push nesta correção.

## Step Implementations

### SI-03.1 — Confirmar baseline e ambiente

- **Status:** completed
- **Tests:** baseline final executado em 2026-11-08; aprovado
- **Observations:** autorização recebida; branch, revisão-base, merge-base e
  alterações locais preexistentes foram registrados. Banco descartável isolado
  e conexões do helper/AppModule foram confirmados. Migrations existentes foram
  aplicadas com sucesso somente em `streamtube_phase03_test`; DB e Mailpit ficaram
  saudáveis. `npm ci` concluiu (1020 pacotes; auditoria informou 65
  vulnerabilidades preexistentes). O autofix de lint não alterou o fingerprint.
  Fingerprint congelado e pós-gates:
  `065bf940cea019e02ae76e84c34052ed12525ffc797aec318a01c0d181a7257e`.

  Gates baseline:

  - `npm test -- --runInBand`: falhou; 2/23 suites e 5/144 testes falharam.
    `auth.service.integration-spec.ts` excedeu timeout de 5s no bootstrap;
    `migrations.integration-spec.ts` encontrou enum residual ao reaplicar
    migration. Após o resumo, Jest manteve handles abertos e foi interrompido.
  - `npm run test:e2e -- --runInBand`: exit 1; 1/3 suites e 43/52 testes
    falharam por timeout de 5s no bootstrap de `auth.e2e-spec.ts`.
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint -- --no-fix`: exit 1; 190 ocorrências (150 erros e 40
    warnings), majoritariamente tipagem insegura em testes preexistentes.

  O critério do SI-03.1 determina que falha de baseline bloqueia os SIs
  funcionais. Corrigir a suíte/lint de autenticação anterior à Fase 03 amplia o
  escopo para remediação preexistente e requer decisão explícita.

  Remediação autorizada e concluída: timeout Jest tornou o bootstrap Docker
  portável; cleanup de migration remove enum residual sequencialmente; mocks de
  teste receberam regras ESLint adequadas sem relaxar produção; erros reais de
  tipagem foram corrigidos. Evidência focal: auth integration 25/25, migration
  2/2, channels 5/5 e auth E2E 45/45.

  Gates finais do baseline:

  - `npm test -- --runInBand`: exit 0; 23/23 suites, 144/144 testes.
  - `npm run test:e2e -- --runInBand`: exit 0; 3/3 suites, 52/52 testes.
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint -- --no-fix`: exit 0; 0 erros, 40 warnings de argumentos
    inseguros em doubles de testes preexistentes.
  - Fingerprint candidato/pós-gates:
    `f67344c8156eebe502b2bf20029f7a8603af88f4ae86b5e5a57cab1072a0640a`.

### SI-03.2 — Preparar dependências e infraestrutura

- **Status:** completed
- **Tests:** configuração 9/9; infraestrutura real 2/2; TypeScript exit 0
- **Observations:** dependências exatas instaladas e `npm ci`/peer dependencies
  verificados no container. Worker usa Node fixado com FFmpeg/ffprobe
  `5.1.9-0+deb12u1`, imagem
  `sha256:b380056bee9d83686e2d919e3c5efb7a20d04fa038b8cdd885b50b81217c46ca`.
  MinIO foi compilado do release `RELEASE.2025-10-15T17-29-55Z`, commit
  `9e49d5e7a648`, Go 1.24.8; imagem
  `sha256:d56c2c45e5887ce6293c8f3d1c4672a1a82d9caec894dc79022cff700f171d40`.
  Redis `7.4.7-bookworm` foi fixado no digest
  `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8`
  com AOF e `noeviction`. Compose validado; DB/Redis/MinIO ficaram saudáveis;
  migrations e init SDK encerraram com código 0. Duas execuções do init foram
  idempotentes. Objeto S3 e chave Redis sobreviveram ao restart; leitura anônima
  do bucket retornou 403. Namespaces `storage`, `queue` e `video`, Joi e
  `.env.example` foram adicionados. A stack de teste usa bucket
  `streamtube-phase03-test`, prefixo Redis `streamtube_phase03_test`, MinIO/Redis
  em `tmpfs` e banco descartável já isolado; nenhum dado de desenvolvimento foi
  utilizado pelos testes de infraestrutura.

### SI-03.3 — Persistir vídeos, sessões e outbox

- **Status:** completed
- **Tests:** migrations 2/2; schema/repository 3/3; regressão focal 10/10
- **Observations:** entidades `Video`, `VideoUploadSession` e
  `VideoProcessingOutbox`, módulo de persistência e migration aditiva criados.
  A migration aplicou três tabelas com checks, índices, UNIQUEs, FK composta de
  ownership e colunas obrigatórias; rollback preservou as quatro tabelas
  anteriores. Testes reais confirmaram unicidade, checks ready/error, ownership,
  idempotência, exatamente um vencedor em claims concorrentes, heartbeat e
  liberação de quota por CAS apenas uma vez. Helper de cleanup passou a respeitar
  a ordem das novas FKs e a regressão de Channel/migrations permaneceu verde.

### SI-03.4 — Integrar storage S3

- **Status:** completed
- **Tests:** integração MinIO real 3/3; TypeScript exit 0
- **Observations:** adapter AWS v3 com clients interno/público separados,
  multipart/listagem paginada/complete/abort/HEAD/delete, assinaturas GET/HEAD/PUT
  e upload/download por streams limitados. MinIO rejeitou parte com comprimento
  diferente do assinado e aceitou a parte correta; bytes e Content-Type foram
  confirmados após complete. GET e HEAD possuem assinaturas distintas. Bucket
  permaneceu privado (403 anônimo); CORS global permitiu a origem configurada e
  não expôs ACAO para origem proibida. O init não usa PutBucketCors no MinIO.

### SI-03.5 — Iniciar drafts e autorizar ownership

- **Status:** completed
- **Tests:** normalização unitária 3/3; draft/quota/provisioning 7/7
- **Observations:** normalização Unicode NFC/basename e hash canônico implementados;
  Idempotency-Key é normalizada para lowercase. Draft e sessão initiating são
  confirmados antes do S3; replay não duplica vídeo e conflito de body é
  rejeitado. Quotas transacionais usam advisory locks e foram validadas para
  dois por canal e dez globais com seis canais. Public IDs usam 128 bits
  base64url e retry `ON CONFLICT`; duas colisões reais foram recuperadas. Falha de
  provisioning preserva um único draft e replay conclui a mesma sessão. A chamada
  S3 foi observada fora da transação. Liberação CAS exige estado terminal e, para
  sessão completed, vídeo ready/error; o chamador só a executa após cleanup.

### SI-03.6 — Controlar retomada e conclusão de uploads

- **Status:** completed
- **Tests:** protocolo DB 12/12; storage real 4/4
- **Observations:** assinatura/listagem usa tamanho exato e TTL limitado à sessão;
  fixture real de 67.108.865 bytes confirmou retomada sem reenviar a primeira
  parte de 64MiB. Completion valida sequência/quantidade/tamanhos, completa e faz
  HEAD antes de transacionar session completed + video processing + outbox único.
  Incomplete retorna a uploading sem evento; mismatch aborta e remove objeto.
  Abort persiste intenção antes do efeito remoto e é idempotente. Completion
  aceita antes do TTL venceu a corrida contra abort/expiração, concluiu após o
  prazo e replay completed não produziu novo evento.

### SI-03.7 — Recuperar sessões e publicar outbox

- **Status:** completed
- **Tests:** outbox/Redis 3/3; reconciliador 3/3
- **Observations:** dispatcher reivindica com `FOR UPDATE SKIP LOCKED`, publica fora
  da transação com jobId estável e confirma por token. Falha/timeout da fila
  mantém evento com backoff; job já publicado antes de crash foi deduplicado.
  Reconciliador expira somente initiating/uploading, mantém quota até cleanup e
  recupera completing por HEAD ou por revalidação integral de todas as partes.
  HEAD 5xx preservou estado/objetos e não foi interpretado como 404.

### SI-03.8 — Expor controle HTTP e contratos

- **Status:** completed
- **Tests:** controller/module/upload/reconciler 20/20; auth + video HTTP e2e
  48/48; TypeScript exit 0
- **Observations:** API owner-only expõe criação/replay, assinatura, polling com
  estado completo, completion, abort e GET canônico. Idempotency-Key UUID,
  Location/Retry-After, limite de controle 64KiB e catálogo distinguem 400,
  404 mascarado, 409, 410, 413, 415, 422, 429 e 503. O teste HTTP real validou
  401/404/413/415/429 sobre PostgreSQL e MinIO isolados. O grafo da API exportou
  as cinco rotas OpenAPI esperadas sem registrar consumidor de fila; a regressão
  completa de auth permaneceu verde.

### SI-03.9 — Inicializar worker separado

- **Status:** completed
- **Tests:** boot de container real, rejeição de FFmpeg ausente e scratch insuficiente (exit 1), shutdown SIGTERM (exit 0), kill/heartbeat/recuperação; e2e 83/83 com worker ativo
- **Observations:** entrypoint standalone agora registra consumidor BullMQ com
  concurrency 1 e verifica FFmpeg/ffprobe e scratch antes de aceitar jobs.
  `video-worker-test` iniciou e registrou ready; job de smoke com vídeo inexistente
  foi consumido pela fila real e terminou no ramo de erro esperado. A API
  permaneceu independente: 4 suites e2e/83 testes passaram com o worker ativo.
  Ensaio isolado com job real comprovou extensão de lease por heartbeat,
  SIGKILL durante a tentativa 1, adiamento até expirar a lease e conclusão
  `ready` pela tentativa 2 após reinício. Falta de FFmpeg e scratch com menos de
  40 GiB rejeitaram readiness com exit 1; shutdown normal saiu com código 0.

### SI-03.10 — Extrair metadados e produzir mídia

- **Status:** completed
- **Tests:** 8/8 integração FFmpeg/PostgreSQL/MinIO na imagem do worker; 4/4 unidade; smoke real MP4 H.264/AAC → ready, dois derivados HEAD/GET válidos
- **Observations:** serviço inicial de processamento implementado. A primeira
  execução expôs BIGINT bruto como string; conversão explícita corrigida e
  repetição passou. Fixture de 88.370 bytes chegou a ready com duração e
  VideoMetadata do contrato; objeto MP4 derivado tem átomo `moov` antes de
  `mdat`, e thumbnail possui assinatura JPEG. Task 10.2 comprovada; SI ainda
  depende de CAS e cenários adicionais de recuperação. Testes posteriores
  confirmaram codec MPEG-4 não aceito → UNSUPPORTED_VIDEO, corrupção H.264/AAC
  a 70% de um MP4 faststart → INVALID_VIDEO, e unidade 2/2 para deadline e
  limite de saída do subprocesso. Task 10.1 comprovada. Três ensaios adicionais
  com MinIO/DB reais provaram CAS: resposta perdida após commit manteve ready e
  derivados; lease substituída manteve processing e removeu derivados perdedores;
  indisponibilidade de leitura do DB preservou derivados para cleanup posterior.
  Task 10.3 comprovada. A suite versionada incluiu codec incompatível, track
  extra, corrupção posterior ao frame de thumbnail, commit com resposta perdida,
  lease vencida, banco indisponível e três falhas transitórias. FFprobe confirmou
  JPEG até 640×360 com proporção preservada. Executada novamente após a última
  alteração de escala, 8/8.

### SI-03.11 — Concluir retry e recuperação do processamento

- **Status:** completed
- **Tests:** recuperação 6/6 em integração real + no-op 2/2 unitários + smoke de três falhas
- **Observations:** orçamento DB de três claims, backoff persistido e
  republish após job Redis ausente/failed foram exercitados. Uma terceira
  lease válida não virou error até expirar. Falha de fonte ausente em três
  tentativas terminou em PROCESSING_FAILED. Reentrega de ready/error foi no-op;
  limpeza removeu derivados perdedores e órfãos de 24h, preservou fonte e
  derivados vencedores e liberou quota uma vez. DB indisponível antes da
  confirmação de ownership adiou exclusão. O e2e HTTP→worker confirmou os
  estados `ready` e `error` com outbox, storage e Redis reais.

### SI-03.12 — Entregar streaming, thumbnail e download

- **Status:** completed
- **Tests:** 6/6 e2e com Nest/PostgreSQL/MinIO; 4/4 unidade
- **Observations:** GET/HEAD privados retornam 307 com assinatura da operação
  correta. A ordem de registro HEAD→GET foi corrigida após um 403 real de
  assinatura inválida no MinIO. Testes cobrem 206 inicial/seek, 416, hash do
  original, JPEG, storage sem assinatura, draft/processing/error sem Location,
  ownership e renovação após expiração da URL. A imagem real gerada pelo worker
  respeita limite 640×360 e proporção.

### SI-03.13 — Validar fluxo completo e regressões

- **Status:** completed
- **Tests:** três arquivos e2e: upload, delivery e processing standalone 2/2;
  suíte padrão 41 suites/237 testes e 5 suites/89 e2e; FFmpeg/DB/MinIO
  condicional 12/12; TypeScript exit 0; Redis parado durante completion HTTP
  e recuperação até `ready` com outbox única, exit 0
- **Observations:** processamento foi executado em perfil separado com worker
  real e fila exclusiva; draft→completion 202 processing→ready/error. A suite
  padrão mantém os 12 testes FFmpeg e 2 e2e de worker condicionais; eles foram
  executados separadamente com exit 0. Em 16/11, os failpoints adicionais
  de AAC corrompido, vídeo/áudio extras, fps/duração inválidos, deadline total
  curto e Redis parado durante completion foram executados; veja
  [matriz](evidence/failpoint-matrix.md). A suíte completa após esses testes
  passou novamente com 237/89.

### SI-03.14 — Comprovar upload de 10GB e desempenho

- **Status:** completed
- **Tests:** duas transferências multipart reais até `ready`; downloads de
  10.000.000.000 e 9.104.679.495 bytes com SHA-256 idêntico à fonte, Range
  206/416, HEAD e JPEG; [relatório e amostras](evidence/large-trials.md)
- **Observations:** cliente containerizado retomou após oito partes e confirmou
  expiração JWT/rotação do refresh. A medição inicial no próprio uploader
  misturou latência da API com carga de envio de quatro streams; o probe em
  container separado registrou p95 de upload/processamento de 4,257/10,229 ms
  (10 GB) e 7,985/4,477 ms (representativo), todos abaixo de 2× baseline e
  500 ms, zero erros e RSS da API dentro de baseline+128 MiB. Event loop,
  amostras individuais e picos MinIO/scratch constam no relatório. O banco
  `tmpfs` foi reconstruído em 16/11 somente para verificar a entrega de objetos
  MinIO persistidos após reinicialização do Docker.

### SI-03.15 — Fechar qualidade e documentação

- **Status:** completed
- **Tests:** backend após autofix: 41 suites/237 testes, 5 suites/89 e2e,
  `npx tsc --noEmit` e `npm run lint -- --no-fix`, todos exit 0. Fingerprint
  SHA-256 de 172 arquivos estável antes/depois dos quatro gates;
  frontend:
  OpenAPI copiada e tipos gerados, `tsc` e lint exit 0, Vitest com concorrência
  limitada: 17 arquivos/67 testes e exit 0. Duas execuções padrão anteriores
  tiveram timeout na inicialização de forks (7 e 1 erros não tratados).
- **Observations:** runbook, AGENTS e README atualizados. O p95 relativo do
  ensaio grande foi comprovado por probe independente. Os 12 testes FFmpeg e
  dois e2e de worker condicionais passaram em execução isolada.
  `git diff --check` exit 0; branch `feature/phase-03-videos`, HEAD/dev/merge-base
  `8459b2f`. Nenhum commit em `main`; integração feature→dev é posterior à
  validação local.

## Integração posterior

- A implementação e a DoD local da change estão completas nesta branch.
- Checklist do plano reconciliado com as evidências: 15/15 entregáveis e 3/3
  critérios finais marcados como concluídos em `phase-03-videos.md`.
- Nenhum commit, push, merge ou arquivamento foi executado nesta aplicação.

## Rastreabilidade R01–R12 — revisão de 16/11/2026

| ID | Evidência | Estado |
| --- | --- | --- |
| R01 | Decisões, `context.md`, `validation.md`, `library-refs.md` e plano da fase | atendido |
| R02 | `AGENTS.md`, `docs/ai/codex/` e script de sincronização | atendido |
| R03 | Draft/retomada/10 GB em e2e e `evidence/large-trials.md` | atendido |
| R04 | Worker FFmpeg real, metadados e JPEG em 12 integrações condicionais e ensaios grandes | atendido |
| R05 | Constraints UNIQUE e colisão injetada em testes de repositório/upload | atendido |
| R06 | Delivery e2e e hash/Range dos dois ensaios grandes | atendido |
| R07 | Estados, retries, CAS e reentrega; matriz de failpoints e Redis parado durante completion HTTP | atendido |
| R08 | Compose com MinIO, Redis e worker; readiness e recuperação após kill | atendido |
| R09 | Migration, FK e constraints reais com teste up/down | atendido |
| R10 | Quatro gates backend exit 0 após autofix; 237 testes, 89 e2e e fingerprint de 172 arquivos estável | atendido |
| R11 | Branch `feature/phase-03-videos` baseada em `dev`; integração/publicação posterior fora desta aplicação | atendido para a change |
| R12 | AGENTS/README/runbook/OpenAPI e tipos gerados | atendido |

R01–R12 têm evidência para a aplicação da change. A integração/publicação no
fork depende do fluxo Git Flow posterior e não altera os gates locais da fase.

## Remediação da auditoria de 16/11/2026 — execução em 17/11/2026

### SI-03.16 — Encapsular persistência e recuperar provisionamento

- **Status:** completed
- **Tests:** boundaries/repositórios/serviços 62/62; upload e reconciliador em
  PostgreSQL 26/26; regressões selecionadas em PostgreSQL/MinIO 6/6; TypeScript
  exit 0.
- **Observations:** SQL e transações de upload, reconciler, processor, recovery e
  outbox foram movidos para repositórios tipados; `ChannelsService` continua
  responsável pela descoberta do canal. Provisionamento `initiating` usa CAS de
  estado/token/lease/prazo, lista multipart paginada por chave exata, escolhe o
  candidato deterministicamente e compensa perdedores. As regressões cobrem
  abort durante `CreateMultipartUpload`, replay concorrente, falha de listagem,
  lease/TTL vencidos e resposta perdida depois de o MinIO criar o multipart; a
  recuperação adotou o upload remoto já existente e manteve exatamente um
  multipart autorizado.

### SI-03.17 — Persistir obrigação durável de cleanup

- **Status:** completed
- **Tests:** migration up/down/reexecução 3/3; repositório paginado 2/2;
  upload/reconciler 26/26; TypeScript exit 0.
- **Observations:** a migration aditiva cria obrigação por sessão com estados
  `pending/verified`, agenda, token/lease e confirmação independentes de
  `quota_released_at`. O backfill inclui terminais cuja quota histórica já foi
  liberada sem re-reservá-la. Abort, expiração e completion agendam na mesma
  operação transacional; confirmação de cleanup marca a obrigação verificada e
  só então libera quota nova. Claims ordenados por agenda usam lotes limitados e
  `SKIP LOCKED`; duas páginas consecutivas alcançaram o trabalho posterior sem
  starvation. Up repetido permaneceu idempotente e down removeu somente a nova
  tabela, preservando vídeos e as quatro tabelas de auth.

### SI-03.18 — Supervisionar streams de storage

- **Status:** completed
- **Tests:** storage unitário 3/3; PostgreSQL/MinIO 5/5; TypeScript exit 0.
- **Observations:** download usa pipeline que propaga erro e teardown da origem
  ao limitador; upload supervisiona produtor, limitador, ponte e `Upload.done()`
  como uma cadeia, abortando e aguardando todos os participantes em qualquer
  falha. `lib-storage` ficou explícito em `partSize=64MiB`, `queueSize=2` e
  `leavePartsOnError=false`. O MinIO real recebeu mais de uma parte antes de uma
  falha tardia da origem; o produtor fechou, o multipart foi abortado e não
  restaram upload autorizado nem objeto final. Limites de upload e download e
  falha de destino também foram exercitados. APIs foram reconferidas na fonte
  oficial via Context7 e no `.d.ts` exato 3.1164.0 instalado.

### SI-03.19 — Aplicar deadline total e perda de lease

- **Status:** completed
- **Tests:** processor/streams unitários 19/19; repositório PostgreSQL 5/5;
  worker FFmpeg/PostgreSQL/MinIO 12/12; TypeScript e build da imagem exit 0.
- **Observations:** um `AbortSignal` por tentativa cobre download, pipelines,
  uploads, HEAD e subprocessos. Deadline mantém default de 90 minutos e só usa
  orçamento curto sob `NODE_ENV=test`; perda de heartbeat aciona o mesmo teardown.
  FFmpeg recebe SIGTERM e escala para SIGKILL, e streams/Upload são aguardados
  antes de sair. O CAS `ready` inclui deadline absoluto no predicado PostgreSQL e
  é novamente cercado por checagens de cancelamento, impedindo commit tardio.
  Testes bloquearam I/O, perderam lease durante comando e confirmaram ausência de
  `ready`/processo vivo. A imagem vigente foi reconstruída; uma execução inicial
  em imagem antiga (8 testes) e outra sem consumidor standalone foram rejeitadas
  como evidência. A topologia correta reconstruída passou os 12 cenários.

### SI-03.20 — Integrar cleanup terminal e efeitos tardios

- **Status:** completed
- **Tests:** recovery PostgreSQL/Redis/MinIO 7/7; recovery unitário 1/1;
  processor FFmpeg/PostgreSQL/MinIO 12/12; TypeScript exit 0.
- **Observations:** a varredura terminal passou a reivindicar a obrigação durável,
  não a filtrar por quota ainda reservada. Ela relê ownership, preserva fonte
  completed e derivados vencedores de ready, remove objetos de todos os attempts,
  aborta multiparts de fonte/derivados, remove scratch e verifica ausência antes
  de confirmar obrigação + quota atomicamente. Falhas de DB/storage mantêm
  `pending` com backoff. Sessão liberada havia um dia foi reavaliada sem alterar o
  timestamp de quota; multiparts e loser foram removidos, e um PUT tardio após
  `verified` foi encontrado na varredura seguinte. Os cenários do processor
  cobrem terceira falha, lease perdedora, resposta perdida do CAS e DB
  indisponível sem apagar possível vencedor.

### SI-03.21 — Saturar backoff da outbox

- **Status:** completed
- **Tests:** outbox PostgreSQL/Redis 7/7.
- **Observations:** incremento usa bigint intermediário e satura em INT_MAX;
  potência limita o expoente antes do cálculo e o atraso em 300 segundos.
  Contadores 0, 6, 60 e 2.147.483.647 foram exercitados no PostgreSQL. Redis
  indisponível manteve evento pendente e `processing_attempts=0`; após retorno,
  o mesmo evento publicou uma vez com jobId estável, preservou o contador de
  transporte e foi confirmado no banco. Crash pós-publicação continuou
  deduplicado pela fila.

### SI-03.22 — Classificar mídia e restringir subprocessos

- **Status:** completed
- **Tests:** processor unitário 17/17; worker FFmpeg/PostgreSQL/MinIO 13/13
  mais referência externa isolada 1/1; TypeScript/build exit 0.
- **Observations:** ausência de track de vídeo e corrupção resultam em
  `INVALID_VIDEO` permanente; codec, quantidade/tipo de tracks e cover art não
  aceitos resultam em `UNSUPPORTED_VIDEO`. Spawn/I/O/ENOSPC e falhas de geração
  são transitórios e seguem o orçamento finito de três claims. Todas as chamadas
  ffprobe/ffmpeg forçam demuxer `mov` e whitelist `file,pipe`. Fixtures reais
  cobriram MP4 só com áudio, codecs/tracks não aceitos, AAC e vídeo corrompidos,
  ENOSPC sintético e playlist com referência HTTP; a última foi rejeitada sob a
  política local sem habilitar protocolo de rede.

### SI-03.23 — Corrigir parser, expiração e contrato HTTP

- **Status:** completed
- **Tests:** fronteiras/parser HTTP 4/4; upload service 14/14; contratos
  selecionados e2e 4/4; configuração 5/5; TypeScript exit 0.
- **Observations:** parser JSON específico de `/videos` precede o genérico, mede
  bytes descomprimidos e produz envelopes próprios para 400/413/415. Foram
  testados 65.535/65.536/65.537 bytes, >100KiB, chunked, gzip, JSON inválido,
  charset e text/plain. Completion declara DTO vazio, rejeita conteúdo, distingue
  parte ausente (409) de tamanho divergente (422), e URLs assinadas usam
  `Cache-Control: no-store`. Regressões existentes cobrem relógio DB, último
  segundo, expired/replay e precedência completing/completed. `canonicalUrl` é
  absoluta por `API_PUBLIC_URL` e ignora Host não confiável. OpenAPI foi exportada,
  copiada com SHA-256 idêntico e os tipos frontend foram regenerados por
  `openapi-typescript` 7.13.0.

### SI-03.24 — Endurecer bootstrap, readiness e logs

- **Status:** completed
- **Tests:** bootstrap unitário 3/3; storage/MinIO 6/6; sanitização 2/2;
  healthcheck real com expiração/recovery e restart saudável; estado PostgreSQL
  preservado (1 vídeo antes/depois).
- **Observations:** o init revalida bucket existente e separa contratos: MinIO
  não recebe `PutBucketCors`; AWS valida região e aplica CORS. Uma política
  pública temporária no MinIO permitiu GET anônimo, foi recusada pelo init e
  removida em `finally`; depois, GET voltou a 403 e init repetido passou. O smoke
  AWS real não foi executado porque não há ambiente AWS autorizado; região/CORS
  estão cobertos por contrato mockado. MinIO usa `/minio/health/ready`. O worker
  só grava readiness após `waitUntilReady`, atualiza heartbeat e remove o arquivo
  no shutdown; heartbeat envelhecido falhou e o próximo pulso recuperou, e o
  restart voltou `healthy`. Erros de processor, recovery, runtime e init passam
  por contexto allowlisted (`errorName`/`errorCode`), descartando mensagem,
  stderr, tokens, credenciais e querystrings assinadas.

### SI-03.25 — Reconciliar documentação e mapa de provas

- **Status:** completed
- **Tests:** busca de imports confirmou zero uso de `@nestjs/bullmq`; caminhos
  dos três planos confrontados com a árvore; matriz A/N e R01–R12 reconciliada.
- **Observations:** README/AGENTS/runbook e C4 agora descrevem BullMQ direto,
  outbox durável, readiness efetiva, endpoints/perfis e comandos da stack
  isolada; MCP PostgreSQL está explicitamente fora da execução. A dependência
  Nest não usada foi removida de manifesto/lockfile, preservando `bullmq` 5.
  Os três planos apontam para testes reais e resultados observáveis, e a matriz
  registra a limitação do smoke AWS não autorizado. CLAUDE e evidências
  históricas não foram alterados; OpenSpec permanece ferramenta de trabalho,
  não dependência da documentação pública de operação.

### SI-03.26 — Reexecutar os dois grandes ensaios

- **Status:** completed
- **Tests:** 10.000.000.000 e 9.104.679.495 bytes; clientes/probes exit 0;
  delivery/hash/Range/HEAD/JPEG exit 0 para ambos.
- **Observations:** worker portátil limitado a 2 CPUs/1 GiB, sem cpuset. Cada
  cliente autenticou por login, aguardou ~839 s pela expiração natural, confirmou
  401, rotacionou refresh, retomou oito partes e terminou `ready`; nenhum segredo
  ou TTL foi alterado. Probes independentes tiveram p95 máximo de 4,559 ms no
  baseline, 3,230 ms no upload e 3,983 ms no processamento, com zero erros e
  razões abaixo de 1×. API atingiu no máximo 147,4 MiB; worker 544,1 MiB;
  event-loop p95 máximo 1,537 ms. Bytes, hashes, hardware, digests, janelas,
  disco/scratch e amostras brutas estão em `evidence/large-trials.md`.

### SI-03.27 — Validar o candidato completo

- **Status:** completed
- **Tests:** suíte padrão 274/274 (14 condicionais skipped); e2e padrão 91/91
  (2 condicionais skipped); FFmpeg/DB/MinIO condicional 14/14; worker e2e em
  fila exclusiva 2/2; `tsc --noEmit` backend/frontend exit 0; ESLint sem escrita
  exit 0 com 48 warnings históricos e zero erros.
- **Observations:** após restart do Docker, a primeira tentativa padrão encontrou
  o schema tmpfs ausente; migrations/tabelas foram confirmadas e a execução
  integral válida passou. Uma tentativa FFmpeg na imagem da API foi descartada
  por não conter o binário; outra sem consumidor passou 11/14 e demonstrou a
  topologia incorreta. A evidência válida usou imagem worker reconstruída,
  consumidor standalone `healthy` e passou 14/14. O perfil e2e usou prefixo
  exclusivo `streamtube_phase03_processing_e2e`. O manifesto final antes/depois
  é executado após esta atualização documental para provar árvore congelada.
