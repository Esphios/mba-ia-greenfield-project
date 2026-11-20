---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
review_status: audit-2026-11-18-local-candidate-certified
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-18T05:13:18.9605951Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-17T23:44:23.9433401Z"
  docs/phases/phase-03-videos/phase-03-videos.md: "2026-11-18T05:11:22.5714993Z"
  docs/phases/phase-03-videos/progress.md: "2026-11-18T05:12:00.8134055Z"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-11-06T21:14:04.503811+00:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-11-06T21:14:04.504811+00:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-06T21:14:04.502806+00:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-17T23:44:27.6810605Z"
issues:
  - id: AMB-1
    status: resolved
    summary: Fechar recuperação de sessão e orçamento de tentativas
    resolved_by: phase-03-videos/TD-04,TD-06,TD-09 revisions
  - id: AMB-2
    status: resolved
    summary: Distinguir lease ocupada, retry de transporte e orçamento DB
    resolved_by: phase-03-videos/TD-06 revision
  - id: IC-1
    status: resolved
    summary: Throttling global existente incompatível com upload e polling
    resolved_by: phase-03-videos/TD-09 revision
  - id: DG-1
    status: resolved
    summary: Helpers e migrations de teste precisam acomodar novas FKs
    resolved_by: phase-03-videos/TD-09 revision
  - id: OQ-1
    status: resolved
    summary: Materializar versões e referências oficiais das novas libs
    resolved_by: library-refs.md
review_findings:
  - id: RV-01
    status: resolved
    summary: "Baseline antes de isolamento"
    resolved_by: "TD-09; SI-03.1"
  - id: RV-02
    status: resolved
    summary: "CORS incompatível MinIO"
    resolved_by: "TD-03; SI-03.4"
  - id: RV-03
    status: resolved
    summary: "Recuperação de multipart incompleto"
    resolved_by: "TD-06; SI-03.7"
  - id: RV-04
    status: resolved
    summary: "Expiração concorrente e replay completed"
    resolved_by: "TD-06; SI-03.6/7"
  - id: RV-05
    status: resolved
    summary: "Commit com resposta perdida"
    resolved_by: "TD-06; SI-03.10/11"
  - id: RV-06
    status: resolved
    summary: "Quotas e backlog/storage"
    resolved_by: "TD-03/09; SI-03.5/11/15"
  - id: RV-07
    status: resolved
    summary: "Corrupção além do frame inicial"
    resolved_by: "TD-04; SI-03.10"
  - id: RV-08
    status: resolved
    summary: "Seleção de tracks"
    resolved_by: "TD-04; SI-03.10"
  - id: RV-09
    status: resolved
    summary: "Métricas excluíam processamento"
    resolved_by: "TD-09; SI-03.14"
  - id: RV-10
    status: resolved
    summary: "Padding como prova de mídia grande"
    resolved_by: "TD-09; SI-03.14"
  - id: RV-11
    status: resolved
    summary: "JWT expira no ensaio"
    resolved_by: "TD-09; SI-03.14"
  - id: RV-12
    status: resolved
    summary: "Setup insuficiente para quota global"
    resolved_by: "TD-09; SI-03.8/13"
  - id: RV-13
    status: resolved
    summary: "404 incorreto no POST de outro usuário"
    resolved_by: "TD-09; SI-03.8/13"
  - id: RV-14
    status: resolved
    summary: "Lint altera candidato final"
    resolved_by: "TD-09; SI-03.1/15"
  - id: RV-15
    status: resolved
    summary: "Replay durante initiating"
    resolved_by: "TD-06; SI-03.5/8"
  - id: RV-16
    status: resolved
    summary: "Normalização/hash indefinidos"
    resolved_by: "TD-06; SI-03.5"
  - id: RV-17
    status: resolved
    summary: "TTL excede restante da sessão"
    resolved_by: "TD-02; SI-03.6"
  - id: RV-18
    status: resolved
    summary: "Expiração não interrompe transferência"
    resolved_by: "TD-05; SI-03.12"
  - id: RV-19
    status: resolved
    summary: "PUT inválido inutiliza sessão"
    resolved_by: "TD-02; SI-03.6"
  - id: RV-20
    status: resolved
    summary: "Fixture retomável sem múltiplas partes"
    resolved_by: "TD-09; SI-03.8/13"
  - id: RV-21
    status: resolved
    summary: "Nulabilidade e canal da sessão"
    resolved_by: "TD-06; SI-03.3"
  - id: RV-22
    status: resolved
    summary: "Metadados públicos genéricos"
    resolved_by: "TD-04; SI-03.8/10"
  - id: RV-23
    status: resolved
    summary: "Códigos de conteúdo misturados"
    resolved_by: "TD-04; SI-03.10/13"
  - id: RV-24
    status: resolved
    summary: "Decisões históricas contraditórias"
    resolved_by: "TD-06/09; context"
  - id: RV-25
    status: resolved
    summary: "Validação documental superestimada"
    resolved_by: "validation/progress"
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Checks

As nove capacidades têm TD, não há UI nem slices irmãos. Não foram encontradas
decisões estratégicas sem alternativa. Publicação permanece na Fase 04.
A segunda passagem histórica foi complementada pela revisão de 2026-11-07.
A passagem atual conferiu as nove recomendações consolidadas, dependências,
contratos e critérios dos 25 apontamentos, sem lacuna documental remanescente
identificada. Conferência estática: 16 Markdown, 8 frontmatters YAML, links locais,
25 registros RV únicos e 15 SIs pendentes; sem erro de links, fences, encoding ou
whitespace. Isso não comprova runtime nem execução dos novos critérios.
`clean` valida a proposta documental; não equivale a aprovação do usuário, baseline
verde, implementação, ensaio de 10GB ou Definition of Done concluída.

## Resolved Issues

| ID | Achado da primeira passagem | Resolução |
| --- | --- | --- |
| AMB-1 | Recuperação e limites incompletos | Revisões TD-04/06/09: leases, retries, initiating/completing, quotas e subprocessos |
| AMB-2 | Retry poderia confirmar job sem claim ou encerrar terceiro claim ativo | TD-06: adiamento sem ACK, backoff DB, liberação CAS e orçamento persistido como autoridade |
| IC-1 | Throttler global 10/min | TD-09: limites específicos nas rotas novas; auth preservado |
| DG-1 | Helpers/migrations não cobrem novas FKs | TD-09: isolamento, cleanup e relação unidirecional |
| OQ-1 | Referências não materializadas | library-refs: versões registry, Context7 e limites da evidência |

## Revisão adicional de 2026-11-07

Os IDs RV são os apontamentos da revisão solicitada nesta conversa, não resultados
de regras customizadas executadas. Resolvido significa contrato/plano corrigido;
testes de runtime e evidências dos SIs permanecem pendentes. Referências canônicas:
[plano](phase-03-videos.md), [decisões](../../decisions/technical-decisions-phase-03-videos.md),
[upload](../../../nestjs-project/specs/video-upload.plan.md),
[processing](../../../nestjs-project/specs/video-processing.plan.md) e
[delivery](../../../nestjs-project/specs/video-delivery.plan.md).

| ID | Apontamento | Contrato e aceite planejado | Rastreabilidade |
| --- | --- | --- | --- |
| RV-01 | Baseline antes de isolamento | DB_NAME/DB_DATABASE, credencial restrita e current_database antes de DELETE/DROP | TD-09; SI-03.1 |
| RV-02 | CORS incompatível MinIO | Config global MinIO, estratégia AWS por bucket, preflight permitido/proibido | TD-03; SI-03.4 |
| RV-03 | Recuperação de multipart incompleto | Revalidar todas as partes antes de complete; failpoint anterior à validação | TD-06; SI-03.7 |
| RV-04 | Expiração concorrente e replay completed | Precedência de completion aceito, replay terminal após TTL e sweep concorrente | TD-06; SI-03.6/7 |
| RV-05 | Commit com resposta perdida | Reler estado/keys antes de cleanup; DB indisponível adia exclusão | TD-06; SI-03.10/11 |
| RV-06 | Quotas e backlog/storage | Reserva até terminal+cleanup, retenção histórica/capacidade documentadas | TD-03/09; SI-03.5/11/15 |
| RV-07 | Corrupção além do frame inicial | Decode integral dos streams selecionados, erros fatais e limite de garantia | TD-04; SI-03.10 |
| RV-08 | Seleção de tracks | Um vídeo e no máximo um áudio; índices explícitos e rejeição de extras | TD-04; SI-03.10 |
| RV-09 | Métricas excluíam processamento | Coleta até terminal, alvos e amostras separados por etapa | TD-09; SI-03.14 |
| RV-10 | Padding como prova de mídia grande | Dois ensaios: fronteira exata e mídia representativa com pelo menos 9GB de payload | TD-09; SI-03.14 |
| RV-11 | JWT expira no ensaio | Refresh rotation e retomada após expiração sem aumentar TTL auth | TD-09; SI-03.14 |
| RV-12 | Setup insuficiente para quota global | Seis canais; sexto rejeitado pela quota global abaixo de seu limite individual | TD-09; SI-03.8/13 |
| RV-13 | 404 incorreto no POST de outro usuário | Criação válida no próprio canal; 404 apenas para recurso alheio | TD-09; SI-03.8/13 |
| RV-14 | Lint altera candidato final | Autofix antes; lint final sem escrita e fingerprint antes/depois | TD-09; SI-03.1/15 |
| RV-15 | Replay durante initiating | Schema completo 200, lastErrorCode, Retry-After:5 e polling sem duplicação | TD-06; SI-03.5/8 |
| RV-16 | Normalização/hash indefinidos | NFC/trim/basename, controles, pontos de código e array JSON ordenado SHA-256 | TD-06; SI-03.5 |
| RV-17 | TTL excede restante da sessão | min(900s, floor(restante DB)), expiresAt efetivo e rejeição após prazo | TD-02; SI-03.6 |
| RV-18 | Expiração não interrompe transferência | Rejeição de novas requisições após TTL, sem promessa de cancelamento em curso | TD-05; SI-03.12 |
| RV-19 | PUT inválido inutiliza sessão | Rejeitar transferência, permitir reenvio correto e completion no prazo | TD-02; SI-03.6 |
| RV-20 | Fixture retomável sem múltiplas partes | Fixture maior que 64MiB e prova de não reenvio de partes confirmadas | TD-09; SI-03.8/13 |
| RV-21 | Nulabilidade e canal da sessão | NOT NULL e FK composta canal/vídeo, com testes de constraints | TD-06; SI-03.3 |
| RV-22 | Metadados públicos genéricos | VideoMetadata tipado, fps racional, duração arredondada/segura e null por estado | TD-04; SI-03.8/10 |
| RV-23 | Códigos de conteúdo misturados | INVALID_VIDEO para conteúdo inválido e UNSUPPORTED_VIDEO para codec/tracks | TD-04; SI-03.10/13 |
| RV-24 | Decisões históricas contraditórias | Recommendation consolidada; Revisions preservadas e explicitamente supersedidas | TD-06/09; context |
| RV-25 | Validação documental superestimada | Revisão rastreada, critérios de execução pendentes; validação estrutural separada | validation/progress |

## Review Gate

Implementação aguarda revisão do usuário, conforme escopo desta rodada. Escolhas
para atenção: 10GB decimal, MP4 H.264/AAC até 4K com seleção restrita e decode
integral, preview do dono, quota incluindo processing/cleanup, dois ensaios grandes,
retenção do original e MinIO construído do release fixado. Mudanças nessas escolhas
exigem atualizar TDs, contexto, validação, plano e especificações antes do apply.

## Validação da remediação — auditoria de 2026-11-16

**Status de planejamento:** `clean`. Este resultado afirma somente que as
correções auditadas têm decisão, dependência, SI e aceite planejado. Não afirma
implementação, regressão, ensaio, DoD, publicação ou aprovação da fase.

As recomendações revisadas preservam a stack e o escopo backend, mantêm UI fora
da fase e não conflitam com decisões herdadas de configuração/auth/OpenAPI.
SI-03.16–22 são aditivos: nenhum SI executado foi renumerado ou teve sua evidência
histórica apagada. O estado corrente em `progress.md` prevalece sobre seções
datadas antigas.

| ID | Decisão/contrato | Plano | Estado de execução |
| --- | --- | --- | --- |
| A01 | fencing de provisioning por estado/token/lease/prazo | SI-03.16–17 | atendido |
| A02 | AbortSignal/deadline total e perda de lease | SI-03.18 | atendido |
| A03 | cadeia completa de streams supervisionada | SI-03.18 | atendido |
| A04 | cleanup durável antes de nova liberação de quota | SI-03.17–18 | atendido |
| A05 | descoberta/adoção determinística de multipart | SI-03.17 | atendido |
| A06 | parser 64KiB, MIME, DTO vazio, 409/422 e no-store | SI-03.19 | atendido |
| A07 | expiração uniforme pelo relógio DB | SI-03.17, SI-03.19 | atendido |
| A08 | OpenAPI/tipos/security/status/headers fiéis | SI-03.19 | atendido |
| A09 | bootstrap privado separado MinIO/AWS | SI-03.20 | atendido; smoke AWS real não autorizado |
| A10 | backoff/counter saturados antes da aritmética | SI-03.18 | atendido |
| A11 | taxonomia de mídia e protocolos locais | SI-03.18 | atendido |
| A12 | documentação corrente coerente, históricos rotulados | SI-03.21 | atendido |
| A13 | manifesto completo e nova regressão/failpoints | SI-03.21–22 | atendido |
| A14 | ensaios no perfil padrão e JWT natural | SI-03.22 | atendido |
| A15 | persistência encapsulada em repositórios tipados | SI-03.16 | atendido |
| A16 | DB_HOST obrigatório e role restrita confirmada | SI-03.16 | atendido |
| A17 | preparação pública; publicação somente autorizada | SI-03.22 | preparação atendida; publicação pendente externa |
| N01 | TTL fixo de sessão e URL no máximo 900s | SI-03.19 | atendido |
| N02 | canonicalUrl absoluta por API_PUBLIC_URL | SI-03.19 | atendido |
| N03 | lib-storage explícito 64MiB/2 e decisão BullMQ | SI-03.18, SI-03.21 | atendido |
| N04 | caminhos reais nos três planos de teste | SI-03.21 | atendido |
| N05 | testes por contrato, sem acesso privado desnecessário | SI-03.21 | atendido |
| N06 | readiness real do worker e MinIO | SI-03.20 | atendido |
| N07 | revalidação de bucket existente | SI-03.20 | atendido |
| N08 | contexto de log sanitizado central | SI-03.20 | atendido |
| N09 | MCP desativado e comandos/arquitetura vigentes | SI-03.21 | atendido |

Conferência estática desta passagem: 26/26 IDs têm decisão e SI; dependências
SI-03.16→17→18/19 e SI-03.16→20 convergem em SI-03.21→22; nenhum item depende de
UI de vídeos ou upgrade de stack; A17 mantém o gate externo; nenhuma caixa de
execução foi marcada por esta validação. Não há inconsistência, ambiguidade,
decisão ausente, gap de dependência, conflito herdado ou questão aberta de
planejamento. A DoD runtime permanece pendente.

## Validação corrente — auditoria de requisitos de 2026-11-18

**Status de planejamento:** `clean`. Este status significa exclusivamente que
F01–F12/N01–N12 possuem decisão, unidade, dependência, teste e aceite planejados.
Não comprova implementação, regressão, ensaio, Definition of Done, aprovação,
commit, integração ou publicação.

- SI-03.1–15: base histórica.
- SI-03.16–27: remediação histórica executada em 17/11/2026, com os mesmos títulos
  e significados em plano e progresso.
- SI-03.28–36: trabalho corrente concluído com regressões, gates, dois ensaios
  grandes e certificação sobre a mesma árvore congelada; os artefatos públicos
  preservam tentativas reprovadas/interrompidas e os resultados aprovados.
- SI-03.37 recebeu autorização para commit e reconciliação local; a publicação
  remota continua dependente de autorização distinta.

| Requisitos | Unidades correntes | Evidência pública observada / pendência |
| --- | --- | --- |
| F01–F04 | SI-03.28, SI-03.34, SI-03.36–37 | [stack e certificação local](evidence/remediation-2026-11-18.md); manifests e gates congelados concluídos, publicação remota pendente |
| F05–F06 | SI-03.29 | [52 testes dirigidos + 3 e2e](evidence/remediation-2026-11-18.md) em PostgreSQL/MinIO reais |
| F07–F09 | SI-03.30 | [matriz corrente](evidence/failpoint-matrix.md) de corrida, relógio DB, CAS e TTL |
| F10–F11 | SI-03.31 | [regressões F08–F12](evidence/remediation-2026-11-18.md), documento OpenAPI e tipos regenerados |
| F12 | SI-03.32 | [deadline/cancelamento](evidence/remediation-2026-11-18.md) e recovery de resultado ambíguo |
| N01–N04/N12 | SI-03.33–35 | [dois ensaios correntes](evidence/large-trials.md) medidos por atividade e operação portátil |
| N05–N11 | SI-03.31, SI-03.33, SI-03.36 | [policy/logs/Compose e candidato local](evidence/remediation-2026-11-18.md) e [mídia representativa](evidence/large-trials.md); publicação pública ainda pendente |

Validação estrutural de 18/11: títulos SI-03.16–27 coincidem entre plano e
progresso; SI-03.28–37 têm identidade única; o mapa termina em SI-03.36 antes de
SI-03.37. Nenhuma unidade corrente é declarada executada apenas por esta análise.
