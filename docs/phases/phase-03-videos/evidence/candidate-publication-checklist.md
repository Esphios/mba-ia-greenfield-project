# Candidato público — Fase 03

Data da revisão local/remota: 20/11/2026. Autorizações distintas cobriram os
commits/reconciliação da tarefa 9.2 e a publicação/verificação da tarefa 9.3.

## Estado remoto verificado

- revisão certificada: `a967f9ed28adb4186a29d10744c2be0975bd8491` na branch
  `feature/phase-03-videos`; `upstream/dev=0b82246f…` é ancestral e nenhuma
  rebase ou merge foi necessária;
- commits focados: `2f467af` (fundação Codex), `ff42437` (pipeline), `cbc401b`
  (documentação/evidências), `3d17c2e` (certificação integrada) e `a967f9e`
  (exclusão de artefatos locais); `main` não foi alterada;
- `origin`: `Esphios/mba-ia-greenfield-project`, repositório público e fork de
  `devfullcycle/mba-ia-greenfield-project`;
- push atômico criou `origin/dev` e `origin/feature/phase-03-videos` em
  `a967f9ed28adb4186a29d10744c2be0975bd8491`; `origin/main` permaneceu em
  `8459b2f3a9c0dcad4bd0f31972761c00c52609a1`;
- a API pública do GitHub confirmou `private=false`, `fork=true` e parent
  `devfullcycle/mba-ia-greenfield-project`. A árvore da revisão e os arquivos
  raw de código, OpenAPI, tipos, progresso e manifesto responderam sem credencial
  e com os mesmos blobs locais.

## Conteúdo público do candidato

A lista determinística pública, que inclui arquivos tracked inalterados
necessários à revisão, contém 966 caminhos: 268 em `.claude`, 1 em `.codex`, 388
em `docs`, 197 no backend, 98 no frontend, 3 em `scripts` e 11 na raiz. A revisão
por categoria e o histórico Git cobrem o delta; o manifesto SHA-256 cobre a
árvore pública completa. O par before/after tem SHA-256
`6e825bd85b4402d373fb2e4571170a1622b3467fe6b97d21611f5fc1bb46474c` e
certifica a revisão `a967f9e`. O volume de fixtures grandes não está na árvore Git.

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

1. Commits focados foram criados na feature após revisão de status, arquivos
   novos, whitespace e segredos; OpenSpec/enunciado permaneceram excluídos.
2. `git fetch upstream dev` atualizou a base, e a verificação de ancestralidade
   confirmou que a feature já continha `upstream/dev`; `main` ficou intocada.
3. A primeira repetição pós-commit passou 316 testes padrão, 92 e2e, 14
   integrações FFmpeg, 2 e2e de worker, tsc e lint.
4. Os manifests `candidate-before.sha256` e `candidate-after.sha256` adjacentes
   são a prova autoritativa de identidade da árvore na repetição final dos gates.
5. Após autorização distinta da tarefa 9.3, o push atômico criou `origin/dev` e
   `origin/feature/phase-03-videos`; ambos foram verificados na revisão certificada.
6. Revisão publicada: [`a967f9ed28adb4186a29d10744c2be0975bd8491`](https://github.com/Esphios/mba-ia-greenfield-project/commit/a967f9ed28adb4186a29d10744c2be0975bd8491).
   Código, documentos, OpenAPI/tipos e evidências foram lidos publicamente; a
   árvore remota contém zero `.mcp.json`, `_claude-sessions/`, `openspec/`,
   `docs/desafio/` ou `.large-*`.
