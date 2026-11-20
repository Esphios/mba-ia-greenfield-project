# Verificação do port e da proposta

O port preserva os CLAUDE.md e a fundação original. Os pontos de entrada são
AGENTS.md da raiz, do backend e do frontend. A fonte transportável está em
`docs/ai/codex/`; a ativação local é feita pelo script de sincronização.

## Cobertura verificada

| Origem | Destino | Conferência |
| --- | --- | --- |
| 23 skills originais e recursos (232 arquivos) | skills/ e .agents/skills/ | Todos presentes; cópias locais idênticas à fonte portada |
| 17 regras | rules/ | Nomes/cobertura preservados; leitura explícita pelos AGENTS |
| 6 perfis auxiliares | agents/ | Preservados como prompts de delegação |
| 3 CLAUDE.md | AGENTS por escopo + frontend-guide.md | Regras de runtime e comandos adaptados ao código observado |
| Configuração de ferramentas/hook | .codex/config.toml + AGENTS/README | MCP documentado; lembrete de seleção de skills explícito |

Frontmatter das skills contém name/description válidos; TOML foi analisado.
A revisão encontrou quatro descrições herdadas de perfis com dois-pontos sem
aspas; as descrições dos perfis foram normalizadas para YAML válido no port.
Não houve arquivo original ausente no port. Links Markdown concretos dos novos
artefatos foram conferidos. Três links de exemplo herdados em generate-test-guide
e playwright-cli representam arquivos gerados/placeholders, não recursos perdidos.

A CLI externa gerou skills/commands OpenSpec nesta área durante o trabalho;
esses arquivos foram preservados e não entram na contagem das 23 skills originais.
A fonte portada não sobrescreve nem remove essas skills ao sincronizar.

## Limites da verificação

A configuração MCP foi validada sintaticamente; PostgreSQL/Figma permanecem
inativos e não tiveram conexão exercitada. A sincronização não prova que uma
sessão aberta recarregou seu catálogo: o carregamento explícito continua disponível.
A revisão documental não comprova o runtime da Fase 03.

A proposta OpenSpec local inclui proposal, design, quatro specs e tasks, todas
prontas para revisão. `openspec validate phase-03-videos --strict` passou.
O planejamento canônico versionável permanece na pasta da fase, com 15 SIs
pendentes e validation clean. Os fingerprints usam os mtimes reais das fontes.
OpenSpec e .agents estão ignorados pela configuração preexistente; não são
incluídos automaticamente num futuro commit. Nenhuma regra do .gitignore foi alterada.

Nenhum serviço foi iniciado, dependência instalada, migration executada, teste
backend rodado ou código da feature implementado nesta rodada. Baseline, ensaio
real de 10GB e Definition of Done continuam pendentes. Sem commit ou push.
