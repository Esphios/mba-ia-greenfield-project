O backend do StreamTube inclui upload multipart, processamento de vídeo em
worker separado e entrega privada por URLs assinadas. Consulte o
[runbook de vídeos](../docs/phases/phase-03-videos/runbook.md) para inicialização,
capacidade, retenção e recuperação. O estado de aceite da Fase 03 está em
[progress.md](../docs/phases/phase-03-videos/progress.md).

O limite de 10.000.000.000 bytes é de transporte, não uma promessa de aceitar
qualquer formato. O worker aceita MP4 com exatamente uma faixa principal H.264
`yuv420p`, zero ou uma faixa AAC e largura/altura limitadas respectivamente a
3840×2160. Assim, vídeo portrait com altura acima de 2160 é rejeitado mesmo se
a largura estiver dentro de 3840.

Na remediação corrente, regressões, primeira passagem dos gates e os ensaios de
fronteira e mídia representativa passaram. A repetição da DoD sobre o candidato
congelado permanece um gate separado; consulte `progress.md` antes de declarar
o aceite integral.

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Ambiente containerizado

```bash
docker compose up -d
docker compose ps
```

O job `dependencies` executa `npm ci` usando o lockfile e preenche o volume
nomeado compartilhado pela API, migrations e inicialização do storage. Não é
necessário ter `node_modules` no host. A ordem é `dependencies` →
`migrations`/`storage-init` → `nestjs-api`/`video-worker`; uma segunda subida é
idempotente. O worker usa BullMQ diretamente, e PostgreSQL/outbox mantém a
intenção durável. Confirme `healthy` para MinIO e worker; `Up` isoladamente não
é evidência de prontidão.

Rotas da fase: `POST /videos`, `GET /videos/:publicId`, controle em
`/videos/:publicId/upload`, e delivery privado em `stream`, `download` e
`thumbnail`. A canonical URL deriva de `API_PUBLIC_URL`; URLs assinadas usam o
`S3_PUBLIC_ENDPOINT` alcançável pelo cliente.

O Compose de desenvolvimento já inicia `start:dev`; não abra uma segunda
instância dentro do mesmo container.

## Run tests

```bash
# unit tests
docker compose exec nestjs-api npm test -- --runInBand

# e2e tests
docker compose exec nestjs-api npm run test:e2e -- --runInBand

# test coverage
docker compose exec nestjs-api npm run test:cov -- --runInBand
```

Para DB/Redis/MinIO descartáveis, `compose.test.yaml` é standalone. A primeira
subida instala dependências, inicializa storage e executa migrations antes da
API; `--profile worker` habilita o consumidor real:

```bash
docker compose -f compose.test.yaml --profile worker up -d --build
docker compose -f compose.test.yaml exec -T nestjs-api-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run test:e2e -- --runInBand
docker compose -f compose.test.yaml exec -T nestjs-api-test npx tsc --noEmit
docker compose -f compose.test.yaml exec -T nestjs-api-test npm run lint -- --no-fix
docker compose -f compose.test.yaml --profile worker exec -T -e VIDEO_WORKER_INTEGRATION=1 video-worker-test npm test -- --runInBand
docker compose -f compose.test.yaml exec -T -e VIDEO_WORKER_E2E=1 nestjs-api-test npm run test:e2e -- --runInBand
docker compose -f compose.test.yaml --profile worker down -v --remove-orphans
```

Consulte o [runbook](../docs/phases/phase-03-videos/runbook.md).

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
