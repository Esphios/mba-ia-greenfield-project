# Fundação de IA para Codex

Este diretório contém o port da fundação Claude do StreamTube: skills completas
com seus recursos, regras por caminho e instruções dos leitores auxiliares.
Os originais permanecem preservados. Os três `AGENTS.md` são os pontos de entrada.

## Instalação local e manutenção

Na raiz, execute `./scripts/sync-codex-foundation.ps1` em PowerShell. O script
copia `skills/` para `.agents/skills/`, sem remover skills instaladas por outras
ferramentas. Como esse destino está ignorado no ambiente, a fonte transportável
fica aqui. O script é idempotente para a mesma fonte; arquivos removidos da
fonte precisam de revisão manual no destino. Abra uma nova sessão para atualizar
o catálogo, ou carregue o `SKILL.md` explicitamente na sessão corrente.

As instruções portadas preservam o idioma dos originais para minimizar alteração
semântica. Edite a fonte deste diretório e sincronize novamente. Confira mudanças
nos originais ao atualizar a fundação; não copie novamente sem reconciliar o port.

## Mapeamento do runtime

| Origem | Codex |
| --- | --- |
| `CLAUDE.md` por escopo | `AGENTS.md` na raiz e em cada subprojeto |
| Skills e seus recursos | Fonte neste diretório; descoberta em `.agents/skills/` |
| Regras com frontmatter `paths` | Leitura explícita indicada pelos `AGENTS.md`; glob é metadado, não hook automático |
| Perfis de leitores auxiliares | Prompts em `agents/`, passados a `collaboration.spawn_agent` quando a skill exigir delegação |
| `Read`, `Glob`, `Grep` | Leitura de arquivo, `rg --files`, `rg` (`-P` para lookahead); preserve filtros e contratos de saída |
| `Write`, `Edit` | `apply_patch` ou ferramenta de edição disponível |
| `Bash` | Shell disponível; nesta máquina PowerShell. Comandos da aplicação continuam no container |
| `Task` / subagent type | Delegação com o conteúdo do perfil, escopo, inputs e saída esperada; não invente agente pré-registrado |
| `Skill` / `/nome` | Ler o `SKILL.md` e aplicar; invocação explícita por `$nome` quando disponível |
| `AskUserQuestion` | Pergunta pela ferramenta de esclarecimento disponível ou conversa; respeite autorizações já dadas |
| `TodoWrite` | Plano/checklist do runtime e registro de progresso da fase |
| `stat -c '%y'` | No PowerShell, `(Get-Item -LiteralPath caminho).LastWriteTimeUtc.ToString('o')` |

Referências a ferramentas nos textos portados são operações abstratas conforme
esta tabela, não nomes de APIs que o Codex precise possuir. Agentes auxiliares
são somente leitores; não lhes atribua edição quando o contrato original for
read-only. Nenhum modelo específico é imposto.

Campos exclusivos `disable-model-invocation`, `allowed-tools` e `tools` foram
removidos do frontmatter. Descrições de perfis auxiliares foram colocadas entre
aspas para manter YAML válido quando contêm dois-pontos. Isso não concede permissões: as restrições do runtime
continuam valendo. O hook que lembrava de selecionar skills virou instrução
explícita no `AGENTS.md`. A ativação do plugin Figma não é portável; use a conexão
Figma disponível quando uma tarefa de frontend a exigir.

## Pipeline e proposta

Use `research`, `plan-context`, `plan-validate`, `plan-resolve`, nova validação
até `clean` e `plan-build`. Preserve nomes e formatos dos artefatos em
`docs/decisions/` e `docs/phases/`. Os estágios são executados explicitamente,
sem regeneração silenciosa. A solicitação atual autoriza preparar o conjunto
de planejamento para revisão; escolhas do agente devem ser identificadas como
propostas técnicas, nunca atribuídas ao usuário. `clean` significa ausência de
lacunas de planejamento, não aceite do usuário nem comprovação da implementação.

Use o identificador `phase-03-videos` para a Fase 03. O arquivo de decisões
exigido é `technical-decisions-phase-03-videos.md` e a pasta é
`docs/phases/phase-03-videos/`. Normalize apenas uma vez o prefixo `phase-NN-`:
não produza `phase-03-phase-03-videos`. Essa compatibilidade preserva as pastas
históricas e os nomes requeridos pela entrega.

OpenSpec é um complemento local de proposta/design/specs/tarefas. A CLI
`openspec` instalada no host pode inicializar a integração Codex e gerar suas
skills. Não execute apply nem arquive uma proposta como entregue enquanto houver
implementação pendente. Os artefatos da fase permanecem o plano canônico público;
não inclua dependências de arquivos locais ignorados nesses documentos.

## MCP e segredos

O Context7 está disponível nesta sessão. Consulte-o para APIs de bibliotecas.
A configuração de projeto está em `.codex/config.toml`: Context7 remoto,
PostgreSQL e Figma locais desativados até serem necessários. O endereço do
PostgreSQL é o exemplo público de desenvolvimento do Compose, não um segredo
pessoal. O servidor MCP PostgreSQL é um processo de ferramenta no host, fora da
regra de execução npm da aplicação. Sua conexão não foi exercitada neste port.
Não copie `.mcp.json` nem configurações pessoais. O exemplo Claude inclui MCP de
PostgreSQL e Figma; eles não são necessários para o planejamento backend.
Para ativá-los no Codex, configure uma conexão atual e autorizada, com variáveis
de ambiente para credenciais e endereço alcançável pelo processo MCP. Não
confunda o host do MCP com DNS de serviços dentro do Compose.

## Fontes de compatibilidade

- [Skills locais e recursos](https://developers.openai.com/codex/skills/).
- [Instruções por escopo com AGENTS.md](https://developers.openai.com/codex/guides/agents-md/).
- [Configuração MCP](https://developers.openai.com/codex/mcp/).

As regras de descoberta documentadas orientam o port. A presença dos arquivos
ou sua validação estática não prova que uma sessão já aberta recarregou o catálogo.
