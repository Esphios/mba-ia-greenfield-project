# Instruções para Codex — StreamTube

## Projeto e escopo

StreamTube é uma plataforma de compartilhamento de vídeos. A visão está em
`docs/project-plan.md` e a arquitetura em `docs/diagrams/software-arch.mermaid`.
O monorepo contém backend NestJS 11 em `nestjs-project/`, frontend Next.js 16 e
React 19 em `next-frontend/`, e decisões/planos em `docs/`.
Leia também o `AGENTS.md` do subprojeto antes de trabalhar nele.

O código atual cobre configuração, autenticação, usuários, canais e frontend de
autenticação. A Fase 03 implementa no backend persistência de vídeos, storage
S3/MinIO, fila/outbox, controle HTTP de upload, worker FFmpeg e delivery
privado. Os dois ensaios grandes da remediação corrente cumpriram os critérios
de conteúdo, delivery, recursos e desempenho com probe independente; a
certificação do candidato congelado ainda consta como pendente em
`docs/phases/phase-03-videos/progress.md`. A interface de vídeos está fora dessa
fase.
Uma solicitação de proposta autoriza apenas documentação e planejamento;
aguarde a revisão do usuário antes de implementar.

Para validar a Fase 03, `nestjs-project/compose.test.yaml` é standalone. Use
`docker compose -f compose.test.yaml --profile worker up -d --build`; os jobs de
dependências, storage e migrations precedem API/worker. Execute os quatro gates
no `nestjs-api-test`, o perfil `VIDEO_WORKER_INTEGRATION=1` no
`video-worker-test` (imagem com FFmpeg) e `VIDEO_WORKER_E2E=1` no
`nestjs-api-test`; finalize com `docker compose -f compose.test.yaml
--profile worker down -v --remove-orphans`. Não combine o arquivo com
`compose.yaml` nem inicie outra instância de `start:dev`.

## Fundação de IA

Leia `docs/ai/codex/README.md`. As skills, regras, templates, referências e
instruções de delegação portadas são mantidas em `docs/ai/codex/`.
Para instalar as skills locais, execute na raiz:

```powershell
./scripts/sync-codex-foundation.ps1
```

As cópias em `.agents/skills/` são geradas. Edite a fonte em
`docs/ai/codex/skills/` e sincronize novamente. Se uma skill não aparecer no
catálogo da sessão, abra seu `SKILL.md` explicitamente; não alegue descoberta
automática sem verificá-la. Os slash commands dos documentos originais equivalem
à invocação da skill pelo nome no Codex.

Antes de agir, decomponha a tarefa e leia as skills pertinentes. O pipeline
canônico é `research → plan-context → plan-validate → plan-resolve →
plan-validate (clean) → plan-build → implement`, com artefatos no formato do
projeto. OpenSpec complementa esses artefatos, sem substituir a pasta da fase.
`plan-phase` é legado; prefira as etapas de `plan-pipeline`.

As regras portadas não são carregadas automaticamente por glob. Leia os arquivos
de `docs/ai/codex/rules/` indicados pelo `AGENTS.md` do subprojeto e todos os que
tenham `paths` correspondentes ao arquivo editado. Para TypeScript, leia
`typescript-strict.md`. Para adicionar regras, atualize também o índice aplicável.

## Arquitetura e qualidade

- Preserve responsabilidade única: controllers HTTP, services de domínio,
  repositórios de persistência, módulos por domínio; não crie entidades de outro
  domínio dentro de um serviço sem passar pelo módulo responsável.
- Use os padrões efetivos de TypeScript, ESLint, Prettier e testes do subprojeto.
- Antes de usar APIs de bibliotecas, confira versões em manifesto/lockfile e
  documentação oficial via Context7. Registre divergências de versão; apenas
  operações triviais ou CRUD já estabelecido dispensam consulta.
- Dentro dos containers, use nomes dos serviços Compose (`db`, `nestjs-api`),
  nunca `localhost` para outro serviço. Probes no host e URLs públicas usam
  endereços alcançáveis pelo cliente; não substitua esses hosts por DNS interno.
- Execute npm, npx, Node, tsc e testes do backend no container. As exceções de
  Playwright no host estão no guia do frontend. Git, Docker, PowerShell e a CLI
  OpenSpec são ferramentas de orquestração no host.
- Não leia nem copie segredos para documentos. Use arquivos de exemplo para
  documentar configuração. Preserve configurações locais e alterações do usuário.

## Definition of Done

Durante implementação, rode os testes afetados. Antes de encerrar uma alteração
funcional, a suíte completa aplicável, testes e2e, `npx tsc --noEmit` (exit 0) e
`npm run lint` devem passar no ambiente documentado. Não declare a fase concluída
com validação apenas documental. Em uma entrega só de plano, verifique caminhos,
referências, cobertura dos critérios e consistência dos artefatos; registre a DoD
de execução como pendente, sem iniciar a aplicação por consequência.

## Git e limites

- Git Flow: `main` estável, `dev` de integração; `feature/*`, `bugfix/*` e
  `hotfix/*` partem de `dev` e retornam a `dev`. Nunca faça commit direto na main.
- Mensagens de commit curtas, descritivas e focadas no motivo.
- Um escopo por alteração. Registre itens alheios como tarefas separadas.
- Não misture formatação cosmética com mudanças funcionais.
- Preserve os `CLAUDE.md` originais. Mantenha este equivalente coerente com o
  código e indique claramente funcionalidades ainda planejadas.
