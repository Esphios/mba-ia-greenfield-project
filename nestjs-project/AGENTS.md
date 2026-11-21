# Instruções para Codex — backend

Leia o `AGENTS.md` da raiz e as regras em `../docs/ai/codex/rules/`.

## Ambiente e comandos

O backend usa NestJS 11, Express, PostgreSQL 17, TypeORM 0.3, JWT, Argon2,
Joi, Jest e Supertest. Confira versões exatas no lockfile.
O Compose contém um job `dependencies` que executa `npm ci` em volume nomeado
antes de `migrations` e `storage-init`; esses jobs antecedem a API. Um clone sem
`node_modules` local sobe pelo mesmo fluxo. O worker instala dependências na
própria imagem. Subir infraestrutura não amplia autorização para outros processos.

Execute a partir de `nestjs-project/`:

```sh
docker compose -f compose.test.yaml --profile worker up -d --build
docker compose -f compose.test.yaml --profile worker ps
docker compose -f compose.test.yaml exec -T nestjs-api-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run test:e2e -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npx tsc --noEmit
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run lint -- --no-fix
docker compose -f compose.test.yaml --profile worker exec -T -e VIDEO_WORKER_INTEGRATION=1 video-worker-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T -e VIDEO_WORKER_E2E=1 nestjs-api-test npm run test:e2e -- --runInBand
docker compose -f compose.test.yaml --profile worker down -v --remove-orphans
```

`compose.test.yaml` é standalone; `migrations-test` precede API/worker e o perfil
real é `worker`. O Compose de desenvolvimento já inicia `start:dev`; não inicie
uma segunda cópia. Inspeção e teardown executam no host. Nunca execute npm/npx/node/tsc do
backend no host. Testes compartilham banco: unitários + integração e e2e devem
usar `--runInBand` explicitamente; o script e2e atual não contém essa flag.

## Regras por artefato

Todos os caminhos abaixo são relativos a `docs/ai/codex/rules/` na raiz:

| Ao trabalhar em | Leia |
| --- | --- |
| Qualquer TypeScript do backend | `typescript-strict.md`, `nestjs-common-conventions.md`, `nestjs-layer-separation.md` |
| Módulos e serviços | `nestjs-modules.md`, `nestjs-services.md` |
| Controllers e DTOs | `nestjs-controllers.md`, `nestjs-dtos.md` |
| Entidades e consultas | `nestjs-entities.md`, `typeorm-queries.md` |
| Migrations | `typeorm-migrations.md` |
| Autenticação e autorização | `auth-jwt.md` |
| Testes | `nestjs-testing.md` e skill `testing-guide-nestjs-project` |

Cada domínio tem módulo registrado no `AppModule`. Controllers tratam transporte
HTTP; services concentram regras; erros de domínio seguem o filtro existente.
Use DTOs validados e contratos Swagger, métodos REST, substantivos plurais e
status HTTP coerentes. Confira `src/auth/` como referência existente.

## Testes e configuração

- `*.spec.ts`: unidade, sem DB/rede, colaboradores mockados, junto ao código.
- `*.integration-spec.ts`: DB e módulos reais, junto ao código.
- `test/*.e2e-spec.ts`: aplicação Nest completa e HTTP via Supertest.
- Preserve `setupFiles: ["dotenv/config"]` e o regex que inclui unidade e
  integração; não introduza sufixos ignorados pelo Jest.
- Leia o guia de testes antes de especificar testes e overrides dos guards.
- `.env` é lido por Compose e dotenv; valores com espaços ou caracteres
  especiais precisam de aspas. Não copie credenciais para artefatos.
- Assets não TypeScript usados em runtime (como `.hbs`) devem constar em
  `nest-cli.json` com `watchAssets`; `tsc` sozinho não os copia.
- `nodenext`, ES2023, decorators e metadata são configurações atuais. Preserve
  single quotes/trailing commas e as regras efetivas do ESLint.
- Migrations são a fonte de evolução do schema. Não use `synchronize: true`.

## Vídeos — implementação e validação

A Fase 03 possui persistência de vídeos/sessões/outbox, integração S3/MinIO,
Redis/BullMQ direto (sem `@nestjs/bullmq`), upload multipart, rotas de controle,
worker FFmpeg e delivery privado. SI-03.1–27 preservam o histórico e
SI-03.28–37 registram a remediação corrente em
`docs/phases/phase-03-videos/progress.md`. O candidato integrado certificado
localmente executou 316 testes padrão, 92 e2e, 14 integrações FFmpeg e 2 e2e de
worker; a mesma revisão foi publicada e verificada no fork.
Os dois ensaios grandes correntes com probe independente cumpriram os critérios
de conteúdo, delivery, recursos e latência; use apenas a seção corrente de
evidências para aceitar a remediação. Preserve os registros datados em
`docs/phases/phase-03-videos/`.
Para a stack isolada, use somente `compose.test.yaml` com `--profile worker`;
não considere o worker pronto até o healthcheck estar `healthy`. Perfis
condicionais são `VIDEO_WORKER_INTEGRATION=1` e `VIDEO_WORKER_E2E=1`.
