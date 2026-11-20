# Preflight dos ensaios grandes — 18/11/2026

Captura anterior aos ensaios do candidato. Nenhuma variável de ambiente,
credencial ou URL assinada é registrada neste artefato.

## Host e engine

- Host: 12 processadores lógicos, x86-64, 16.959.000.576 bytes de RAM.
- Disco D: 760.434.982.912 bytes livres antes da geração das fixtures.
- Docker Desktop 4.98.0, Engine/CLI 29.9.2, API 1.56, Compose 5.6.1.
- VM Docker: 12 CPUs, x86_64, 8.215.810.048 bytes de RAM.
- Worker renderizado e inspecionado: `NanoCpus=2000000000`,
  `Memory=1073741824`, `CpusetCpus=""`. Portanto o perfil limita 2 CPUs e
  1 GiB, mas não exige índices fixos de CPU.
- Espaço Docker antes dos ensaios: imagens 3,174 GB, volumes 271,2 MB e cache
  de build 13,81 GB (11,51 GB recuperáveis).

## Imagens efetivamente renderizadas

Os valores são IDs/digests completos obtidos após o build e antes das fixtures:

| Serviço | ID/digest completo |
|---|---|
| dependencies-test | `sha256:0a71856502f84d562ea9434cef4d56e5b9662fea0d6dc2872e3ff2e5c0bad8a4` |
| minio-test | `sha256:04549a583b323b780049ff0618340304825ceec0873c8d36a98f89242febd7b2` |
| storage-init-test | `sha256:342e227a1aeadaae762eed1e2b3e8d3c1a3d8a883a5133f4a04c5945e59c0dba` |
| db-test | `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` |
| mailpit-test | `sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a` |
| migrations-test | `sha256:df09c0942a43da266b89546ab101a027d59a7f16d50ad5abf1668a481c625cb2` |
| redis-test | `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8` |
| nestjs-api-test | `sha256:28c4784b207aada48d9d6b115ac83553a55b9f9087bacedf601e8166f61603f5` |
| video-worker-test | `sha256:7fa20162f781dbdc39d8c8eeeccc21bdfa4ebf87392dfa123beb87a623840a2e` |
| large-client | `sha256:b1a0283f008625aadccb32901bf7f6f72e65610e63531520600c6c9324e7fa75` |
| large-probe | `sha256:575bf9efa530193a01d6a687187a5356e74d54f7785ca2657f77b204e6e25a41` |

## Execução certificada do representativo — 20/11/2026

Após preservar as tentativas reprovadas, a stack foi desmontada, os volumes
descartáveis de MinIO e scratch foram recriados e o MP4 de 9.104.679.495 bytes
foi executado novamente. Uma primeira repetição `certified` foi interrompida por
reinício externo do Docker Desktop: todos os serviços saíram simultaneamente com
255 durante processing. Seus CSVs e 293 janelas de event loop foram preservados,
mas não sustentam aceite.

A repetição `certified-final` usou os IDs completos abaixo e terminou com
cliente/probe exit 0. O worker foi inspecionado com
`NanoCpus=2000000000`, `Memory=1073741824` e `CpusetCpus=""`.

| Serviço | ID completo da execução certificada |
|---|---|
| dependencies-test | `sha256:271942051929046082782e5e1af6ed324b0c4baee90c23f5d6e8fd63a8f54036` |
| minio-test | `sha256:cffaba3d30debd6f5a3ec278173c5718c71ef6993821104705a7e0db452e40c8` |
| storage-init-test | `sha256:32e4908be59614740edf1085f76e650f78057cb99b9af5c77c64e4815484f50a` |
| db-test | `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` |
| mailpit-test | `sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a` |
| migrations-test | `sha256:c1436a74724c0177b9ed80528581ae30129122f479cacd2b26cedc088ae3622b` |
| redis-test | `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8` |
| nestjs-api-test | `sha256:68014bd27344397a44e68b9d53c6938fbd087f339e797de57eec2f7cdd0c1662` |
| video-worker-test | `sha256:f95c8bd2d07e83378d8d0c2590a9a84c0ab98600068e5ff60eac9263d2862ce0` |
| large-client | `sha256:b1a0283f008625aadccb32901bf7f6f72e65610e63531520600c6c9324e7fa75` |
| large-probe | `sha256:575bf9efa530193a01d6a687187a5356e74d54f7785ca2657f77b204e6e25a41` |

## Rebuild final com janela abaixo de 120/min — 19/11/2026

O primeiro ensaio paced mostrou 23 respostas 429 porque baseline mais a janela
de 100 ms ultrapassaram 120 requests no mesmo minuto. Após reduzir somente essa
janela para 250 ms, o stack e os volumes de MinIO/scratch foram recriados outra
vez; o cliente continuou com quatro PUTs de 16 MiB/s e o worker preservou
2 CPUs/1 GiB sem cpuset.

| Serviço | ID/digest completo do rebuild final |
|---|---|
| dependencies-test | `sha256:6f78432835aba8c4ba3c279154d2eb6c6518cbc18f0d3e5524c0274ee8a0b002` |
| minio-test | `sha256:0d9302151bc303cf24a6893d261a562db866eb42fba4d8e0b697ee228cec5340` |
| storage-init-test | `sha256:a481ae9c7995757cef371761387da9c5f80c2d81479be8e96ce857d4c300fd42` |
| db-test | `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` |
| mailpit-test | `sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a` |
| migrations-test | `sha256:053782c7ce0bc9793799625d1382f681240a678414fb418cd8c310f8e8251f57` |
| redis-test | `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8` |
| nestjs-api-test | `sha256:ff691af01f15afaa4a158fe69ccce4a1b4b9f58a7e967d479b2cb938ff4042f1` |
| video-worker-test | `sha256:040e4925d8c1ef2fada89f0313631e626ae84b5d5fec994451eca2db10e86aac` |
| large-client | `sha256:b1a0283f008625aadccb32901bf7f6f72e65610e63531520600c6c9324e7fa75` |
| large-probe | `sha256:575bf9efa530193a01d6a687187a5356e74d54f7785ca2657f77b204e6e25a41` |

`dependencies-test`, `storage-init-test`, `migrations-test`, API, worker e os
dois clientes são imagens locais imutáveis por ID. PostgreSQL, Redis, Mailpit e
MinIO também foram inspecionados pelo ID completo da imagem usada, e não por
um prefixo abreviado.

## Rebuild após ajuste de cadência — 19/11/2026

Após corrigir apenas a cadência do probe, o stack foi novamente removido, os
volumes de MinIO/scratch foram recriados e todas as imagens renderizadas foram
reinspecionadas. Esse reensaio eliminou 429, mas foi preservado como reprovado
porque a janela de retomada excedeu 2× baseline. A fixture permaneceu em volume
isolado; o worker continuou com `NanoCpus=2000000000`, `Memory=1073741824` e
`CpusetCpus=""`.

| Serviço | ID/digest completo do reensaio |
|---|---|
| dependencies-test | `sha256:fe86b035ee65940ad085d9e0e7476ec871ddc4508c73e52fe2d31507b91f4920` |
| minio-test | `sha256:a22342a3ae40467d5d8e9c9c051bee08f9d62ef80761b0e1a0b7b1cb41647c8d` |
| storage-init-test | `sha256:85e6698337383e2299c44257f2c4ac505a966a7326e9bdbfc4e99ff6dc3688a8` |
| db-test | `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` |
| mailpit-test | `sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a` |
| migrations-test | `sha256:516ed1d2b47de4d1cf93424e178f32840080024af064837c74c822cb7f0a2086` |
| redis-test | `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8` |
| nestjs-api-test | `sha256:a296bd7d5dd873a1b15fa2eadf841b77d454d30e69f43bac5c5c2f51a65d09fc` |
| video-worker-test | `sha256:6d213cc7fe25b4e674f436e4ba423793bcbb63fa202d16b60a042650985a84cb` |
| large-client | `sha256:b1a0283f008625aadccb32901bf7f6f72e65610e63531520600c6c9324e7fa75` |
| large-probe | `sha256:575bf9efa530193a01d6a687187a5356e74d54f7785ca2657f77b204e6e25a41` |

## Rebuild do reensaio com PUT paced — 19/11/2026

Antes da repetição com quatro PUTs ativos de 16 MiB/s cada, o stack e os volumes
de MinIO/scratch foram novamente recriados. A inspeção preservou os mesmos
limites de CPU/memória/cpuset do worker e retornou estes IDs completos:

| Serviço | ID/digest completo do reensaio paced |
|---|---|
| dependencies-test | `sha256:9652230f6f03d706a4db0b8bfbd45aadf8d16eb8658047abb607703c3a24ad85` |
| minio-test | `sha256:3cf0bcd520062c11e5863686f7e2aca609aca37f1d9a9a47943aa6e5d064422b` |
| storage-init-test | `sha256:7e5feb6c73a84ee2165c9ef06630ff291d7eda0405351c7f309ffe98830b275e` |
| db-test | `sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac` |
| mailpit-test | `sha256:cae83a33cd9b9598e4acb210be673dda7e741d5271ed4045310ab456950a136a` |
| migrations-test | `sha256:a6b05607fef33f7bb0e4e75a97d204f1ba712399d9a2f5bd8752e7092f598c5c` |
| redis-test | `sha256:976ab0f0939b78c06d802bcd3bea44c5142ea9a756a57b861e08819817f768c8` |
| nestjs-api-test | `sha256:acc80cba30aef62ffacc7b10d5fa670abbae4bdef1e419f4c313e2c9034c55fe` |
| video-worker-test | `sha256:a9a1c8016f5dab6f584a0021dab5664aa2a569c6cfb28aa23eb21ac89f316c0a` |
| large-client | `sha256:b1a0283f008625aadccb32901bf7f6f72e65610e63531520600c6c9324e7fa75` |
| large-probe | `sha256:575bf9efa530193a01d6a687187a5356e74d54f7785ca2657f77b204e6e25a41` |
