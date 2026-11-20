# Candidato público — Fase 03

Data da revisão local/remota: 20/11/2026. Este documento prepara a integração, mas não
autoriza commit, merge ou push.

## Estado remoto verificado

- branch local: `feature/phase-03-videos`; `HEAD`, `dev` local e merge-base
  `HEAD...dev` são `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`;
- `origin`: `Esphios/mba-ia-greenfield-project`, repositório público e fork de
  `devfullcycle/mba-ia-greenfield-project`;
- `git ls-remote --heads origin main dev`, executado em 20/11, leu somente
  `main=8459b2f3a9c0dcad4bd0f31972761c00c52609a1`; o servidor não retornou
  `origin/dev`;
- a única tracking ref local confirmada é `origin/main=8459b2f…`; não existe
  `refs/remotes/origin/dev`, portanto o texto não trata o resultado de
  `ls-remote` como ref local nem afirma que houve fetch;
- `git ls-remote --heads upstream main dev` leu
  `main=8459b2f3a9c0dcad4bd0f31972761c00c52609a1` e
  `dev=0b82246ff8fa9937f556c52ea6bb15357309d289`. As URLs HTTPS dos dois remotos
  responderam sem credencial, evidenciando acesso público de leitura; `origin`
  permanece o fork configurado do projeto upstream. A divergência remota deve
  ser resolvida explicitamente, sem inventar uma tracking ref `origin/dev`.

## Conteúdo público do candidato

`git status --porcelain=v1 --untracked-files=all` listou 494 caminhos alterados
ou novos. A lista determinística pública, que também inclui arquivos tracked
inalterados necessários à revisão, contém 965 caminhos: 268 em `.claude`, 1 em
`.codex`, 388 em `docs`, 197 no backend, 98 no frontend, 3 em `scripts` e 10 na
raiz. A revisão por categoria e `git diff --stat` cobre o delta; o manifesto
SHA-256 cobre a árvore pública completa. O volume de fixtures grandes não está
na árvore Git.

- backend NestJS: configuração, migrations, storage, vídeos, worker, testes,
  fixtures pequenas e scripts de ensaio;
- infraestrutura: Dockerfiles e Compose de desenvolvimento/teste/ensaio;
- contrato: OpenAPI backend e tipos gerados do frontend com hash correspondente;
- documentação: README/AGENTS, decisões, plano/progresso/runbook, arquitetura,
  planos de teste e evidências sanitizadas;
- fundação Codex/Claude pública e scripts de sincronização.

Ficam fora do candidato por regra determinística: `openspec/`, enunciado privado
em `docs/desafio/`, `_claude-sessions/`, `.mcp.json`, arquivos transitórios
`.large-*` e os próprios manifests before/after. Dependências ignoradas,
fixtures de 9–10 GB, outputs voláteis e qualquer arquivo com credenciais/tokens
também não entram. Os `CLAUDE.md` históricos são preservados.
A varredura por headers de chave privada, JWT, tokens GitHub/Slack e access keys
AWS não encontrou correspondência no conjunto público. Os únicos matches amplos
foram valores deliberadamente sintéticos em testes de auth/redação para
`refreshToken` e `X-Amz`; nenhum pertence a configuração ou evidência. Os
artefatos JSON/CSV/JSONL aprovados foram verificados sem JWT, refresh token ou
querystring assinada.

## Checklist de integração feature → dev

1. Confirmar todos os gates e o manifesto SHA-256 estável do candidato.
2. Revisar `git status`, lista de arquivos novos e `git diff --check`; repetir a
   varredura de segredos e confirmar que OpenSpec/enunciado continuam ignorados.
3. Com autorização específica para a tarefa 9.2, executar
   `git fetch upstream dev` e reconciliar localmente `feature/phase-03-videos`
   com `upstream/dev`, sem tocar em `main`; `origin/dev` não pode ser usado como
   base enquanto continuar ausente no servidor.
4. Criar commits focados na feature, integrar na branch `dev` conforme Git Flow
   e repetir os gates afetados se a reconciliação alterar a árvore.
5. Somente com a autorização distinta da tarefa 9.3, fazer push das branches
   autorizadas — inclusive criar `origin/dev`, se esse for o destino aprovado —,
   abrir/revisar a comparação remota e confirmar que código, docs,
   OpenAPI/tipos e evidências públicas estão visíveis no fork.
6. Registrar URL e revisão publicada. Sem autorização, manter as tarefas 9.2/9.3
   aberta e não arquivar a change como entrega integral.
