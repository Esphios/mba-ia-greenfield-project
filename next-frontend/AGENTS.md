# Instruções para Codex — frontend

Leia o `AGENTS.md` da raiz. Este subprojeto já existe; usa Next.js 16 App Router,
React 19, TypeScript, Tailwind 4, shadcn/ui, iron-session e openapi-fetch.
A interface de vídeos está fora do escopo da Fase 03 de backend.

## Referências obrigatórias

O port integral das instruções específicas está em
`../docs/ai/codex/frontend-guide.md`: leia-o antes de qualquer alteração aqui.
Leia os guias pertinentes em `node_modules/next/dist/docs/` antes de escrever
código; essa versão pode ter APIs diferentes das conhecidas.
Leia também as regras em `../docs/ai/codex/rules/` por assunto:

- `typescript-strict.md` e `next-frontend-code-quality.md` para código;
- `next-frontend-ui.md` para UI;
- `next-frontend-bff-api.md` para integração;
- `next-frontend-testing.md` e `next-frontend-msw-mocks.md` para testes/mocks.

## Contratos que devem ser preservados

- Browser chama Route Handlers same-origin `/api/**`; backend é acessado apenas
  pelo servidor, via `env.API_URL` de `lib/env.ts`. Não exponha backend em
  `NEXT_PUBLIC_*`.
- Tipos de transporte derivam de `openapi.json` → `lib/api/types.gen.ts`; não
  duplique DTOs nem edite tipos gerados manualmente.
- Server Components por padrão; Client Components apenas onde necessários.
- Tokens ficam em `app/globals.css`; não crie `tailwind.config.js`, valores
  visuais arbitrários ou bibliotecas novas de ícones.
- Use `components/ui/button.tsx` como referência, CLI shadcn para primitives e
  ícones próprios em `components/icons/`.
- Figma exige design context + screenshot antes da implementação e uso dos
  assets/tokens reais. A ativação de plugin Claude não configura Codex.

## Execução

Em `next-frontend/`, `docker compose up -d` sobe o container ocioso; não inicie
o dev server sem solicitação. npm/npx/node/tsc/shadcn rodam no container:

```sh
docker compose exec next-frontend npm ci
docker compose exec next-frontend npm test
docker compose exec next-frontend npx tsc --noEmit
docker compose exec next-frontend npm run lint
```

Exceção documentada: Playwright executa no host, apontando a
`http://localhost:3001`. O Next deve estar no container com `MSW_ENABLED=true`.
Não configure `webServer` no Playwright; não intercepte `/api/**` no browser.
Vitest e Playwright compartilham handlers MSW de upstream; os Route Handlers
reais são exercitados. Vitest usa `onUnhandledRequest: "error"`; instrumentation
usa `"bypass"`. Sufixos e pré-requisitos completos estão no guia integral.
