# Candidato público — Fase 03

Data da revisão local/remota: 20/11/2026. A autorização da tarefa 9.2 cobriu os
commits e a reconciliação local descritos aqui; este documento não autoriza push.

## Estado remoto verificado

- branch local: `feature/phase-03-videos`; `upstream/dev` foi atualizado para
  `0b82246ff8fa9937f556c52ea6bb15357309d289` e é ancestral da feature, portanto
  nenhuma rebase ou merge foi necessária;
- commits focados locais: `2f467af` (fundação Codex), `ff42437` (pipeline da
  Fase 03) e `cbc401b` (documentação/evidências); `main` não foi alterada;
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

A lista determinística pública, que inclui arquivos tracked inalterados
necessários à revisão, contém 966 caminhos: 268 em `.claude`, 1 em `.codex`, 388
em `docs`, 197 no backend, 98 no frontend, 3 em `scripts` e 11 na raiz. A revisão
por categoria e o histórico Git cobrem o delta; o manifesto SHA-256 cobre a
árvore pública completa. O volume de fixtures grandes não está na árvore Git.

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

1. Três commits focados foram criados na feature após revisão de status, arquivos
   novos, whitespace e segredos; OpenSpec/enunciado permaneceram excluídos.
2. `git fetch upstream dev` atualizou a base, e a verificação de ancestralidade
   confirmou que a feature já continha `upstream/dev`; `main` ficou intocada.
3. A primeira repetição pós-commit passou 316 testes padrão, 92 e2e, 14
   integrações FFmpeg, 2 e2e de worker, tsc e lint.
4. Os manifests `candidate-before.sha256` e `candidate-after.sha256` adjacentes
   são a prova autoritativa de identidade da árvore na repetição final dos gates.
5. Somente com a autorização distinta da tarefa 9.3, fazer push das branches
   autorizadas — inclusive criar `origin/dev`, se esse for o destino aprovado —,
   abrir/revisar a comparação remota e confirmar que código, docs,
   OpenAPI/tipos e evidências públicas estão visíveis no fork.
6. Registrar URL e revisão publicada. Sem autorização, manter a tarefa 9.3
   aberta e não arquivar a change como entrega integral.
