# Ensaios grandes — 10 e 16 de novembro de 2026

Ambiente: projeto Compose isolado `streamtube-phase03-large`, PostgreSQL em
`tmpfs`, MinIO em volume persistente, API e worker em containers separados.
As duas transferências foram multipart em quatro PUTs paralelos, com parada após
oito partes, listagem e retomada. O cliente leu cada parte com stream de 1 MiB.

| Métrica | Fronteira | Representativo |
| --- | ---: | ---: |
| Fonte | 10.000.000.000 bytes | 9.104.679.495 bytes |
| Payload audiovisual H.264 | amostra 4K de 10 s com átomo `free` para preencher exatamente 10 GB | 9.104.474.372 bytes; 680 s 4K sem preenchimento |
| SHA-256 da fonte e download | `ebd7cc0d65825fe7adf7d3aba91ed8578017e6cbc1322f7f5b3bbfa38058fdbe` | `6496dedbe16a637421e9231651e61de02f475531281654ab921b4664a3e39231` |
| Upload até completion | 34,925 s | 26,631 s |
| Processing até `ready` | 57,387 s | 478,931 s |
| Baseline GET status p95, 60 amostras | 5,938 ms | 3,724 ms |
| Upload GET status p95 | 28,315 ms, 34 amostras | 18,838 ms, 26 amostras |
| Processing GET status p95 | 14,774 ms, 116 amostras | 10,991 ms, 477 amostras |
| Erros de controle observados | 0 | 2 (0,36% de 563 GETs amostrados) |
| API RSS, mínimo → máximo | 132,6 → 143,2 MiB | 140,3 → 146,7 MiB |
| Worker RSS, mínimo → máximo | 80,21 → 471,9 MiB | 120,6 → 591 MiB |

Ambos terminaram `ready` com metadados H.264, 3840×2160, 25 fps; duração de
10.000 e 680.000 ms, respectivamente. O segundo ensaio confirmou 401 para JWT
de teste expirado e rotação do refresh token sem alterar o TTL da aplicação.
Ambos confirmaram original por hash no download, derivados, thumbnail JPEG,
HEAD 200 e Range 206/416. O download representativo foi verificado em
16/11 após reinicialização do Docker. O banco `tmpfs` havia sido perdido;
`test/support/video-large-restore.sql` repôs somente os dois registros de teste
apontando para os seis objetos ainda presentes no volume MinIO. A transferência
e o processamento ocorreram antes dessa restauração.

Coleta de `docker stats` a cada ~5 s: [fronteira](large-boundary-resources.csv)
e [representativo](large-representative-resources.csv), da linha inicial até
próximo ao terminal. Scratch observado em 17 GiB durante o processamento
representativo e vazio depois. MinIO observado em 26 GiB durante upload dos
derivados e 27 GiB após os ensaios. Não houve amostra direta de event loop.

Essa primeira medição de GET feita pelo próprio uploader excedeu o limite
relativo de 2×. Uma repetição identificou 401 gerados pelo polling durante o
teste intencional de JWT expirado; o cliente foi corrigido para suspender esse
polling durante a expiração. A API manteve p95 de atraso do event loop próximo
de 1 ms mesmo quando o uploader observava picos. Como o processo que mede
também envia quatro streams PUT, sua latência inclui a carga local do uploader.

## Medição independente, 16/11/2026

Repetimos ambas as fixtures com API e PostgreSQL nos CPUs 0–1, worker nos 2–7,
MinIO nos 8–9, uploader no 10 e probe de GET no 11. O probe usa JWT de teste
com a mesma validade de 15 min da aplicação, mede GET de status uma vez por
segundo e guarda cada latência e status. O uploader mantém a autenticação real,
interrupção/retomada após oito partes e rotação do refresh após 401 esperado.
O TTL da aplicação não foi alterado.

| Métrica do probe | 10 GB | Representativo 9,1 GB |
| --- | ---: | ---: |
| Baseline p95 | 6,943 ms (60 GETs) | 6,675 ms (60 GETs) |
| Upload p95 | 4,257 ms (90 GETs; 0,61×) | 7,985 ms (65 GETs; 1,20×) |
| Processing p95 | 10,229 ms (31 GETs; 1,47×) | 4,477 ms (510 GETs; 0,67×) |
| Erros do probe / cliente | 0 / 0 | 0 / 0 |
| API RSS mínimo → pico | 113,8 → 116,7 MiB | 105,8 → 120,1 MiB |
| Worker RSS mínimo → pico | 99,07 → 230,5 MiB | 113 → 419,8 MiB |
| Event loop p95 máximo em janela de 5 s | 1,169 ms | 1,378 ms |
| Event loop maior pico isolado | 42,172 ms | 113,246 ms |
| Scratch pico | 10.000.028.672 bytes | 18.209.405.590 bytes |
| MinIO pico (inclui ensaios anteriores) | 48.613.160.008 bytes | 66.823.473.459 bytes |

O probe passou p95 ≤500 ms e ≤2× baseline em upload e processamento, erro
0% e RSS da API bem abaixo de baseline+128 MiB. Os dois vídeos terminaram
`ready` na primeira tentativa, com metadados e derivados. O download da nova
execução representativa repetiu o SHA-256 `6496ded…e39231` sobre
9.104.679.495 bytes, além de 206/416/HEAD/JPEG. A segunda execução de
fronteira também repetiu hash, Range, HEAD e JPEG. As fontes e os artefatos
originais foram verificados sem copiar arquivos de 10 GB para o repositório.

Dados brutos dos ensaios finais:

- 10 GB: [probe](large-boundary-isolated-probe.json),
  [cliente](large-boundary-isolated-client.json),
  [recursos](large-boundary-isolated-resources.csv),
  [disco](large-boundary-isolated-disk.csv),
  [event loop](large-boundary-isolated-eventloop.jsonl).
- Representativo: [probe](large-representative-isolated-probe.json),
  [cliente](large-representative-isolated-client.json),
  [recursos](large-representative-isolated-resources.csv),
  [disco](large-representative-isolated-disk.csv),
  [event loop](large-representative-isolated-eventloop.jsonl).

`collect-large-resources.ps1` amostrou desde antes do baseline até depois do
terminal; o intervalo efetivo variou aproximadamente de 5 a 8 s pelo custo de
`docker stats`/`du`. O preload `video-event-loop-monitor.cjs` registrou uma
janela a cada 5 s. Os JSONs de probe preservam todas as amostras individuais.

## Candidato da auditoria, 17/11/2026

Nova execução dos dois arquivos após a remediação, sem reutilizar o aceite
anterior. Docker Desktop reportou 12 CPUs x86_64 e 8.215.797.760 bytes de RAM;
o worker não foi fixado a CPUs do host e recebeu `cpus: 2.0`/`mem_limit: 1g`.
Imagem worker: `sha256:b35b1c2a…480ca0e2`; MinIO:
`sha256:2a2aa719…18473b3`. Ambos os clientes receberam token por `/auth/login`,
aguardaram sua expiração natural, comprovaram 401 e rotacionaram o refresh token
uma vez. O probe usou uma segunda sessão de login e também rotacionou refresh;
nenhum script assinou JWT com segredo.

| Métrica do candidato | 10 GB | Representativo 9,1 GB |
| --- | ---: | ---: |
| Bytes / SHA-256 | 10.000.000.000 / `ebd7cc0d…58fdbe` | 9.104.679.495 / `6496dedb…e39231` |
| Pausa natural de expiração | 838,332 s | 839,646 s |
| Upload total / ativo aproximado | 896,082 s / 57,750 s | 868,826 s / 29,180 s |
| Processamento até `ready` | 38,127 s | 412,279 s |
| Probe baseline p95 | 3,729 ms (60) | 4,559 ms (60) |
| Probe upload p95 / razão | 3,230 ms / 0,87× (894) | 2,966 ms / 0,65× (867) |
| Probe processing p95 / razão | 3,425 ms / 0,92× (38) | 3,983 ms / 0,87× (411) |
| Erros probe/cliente | 0 / 0 | 0 / 0 |
| API RSS min→máx | 104,0→147,4 MiB | 124,8→128,0 MiB |
| Worker RSS min→máx | 86,36→296,5 MiB | 182,0→544,1 MiB |
| Event loop p95 máximo / pico | 1,524 / 28,590 ms (199 janelas) | 1,537 / 16,744 ms (269 janelas) |
| Scratch observado no pico | 9.547.796.480 bytes | 18.209.430.166 bytes |
| MinIO observado no pico | 76.957.828.044 bytes | 95.167.812.080 bytes |

As duas sessões retomaram oito partes e terminaram `ready` na primeira tentativa.
A verificação posterior também autenticou por login e confirmou download byte a
byte com os hashes acima, Range 206/416, HEAD 200 e JPEG; o stream de fronteira
tem 133.892.145 bytes e o representativo 9.104.679.495 bytes. O critério do
probe (p95 ≤500 ms, ≤2× baseline, erros ≤1%) e o teto de RSS da API foram
atendidos com larga margem.

Dados brutos do candidato:

- 10 GB: [probe](large-candidate-boundary-probe.json),
  [cliente](large-candidate-boundary-client.json),
  [recursos](large-candidate-boundary-resources.csv),
  [disco](large-candidate-boundary-disk.csv) e
  [event loop](large-candidate-boundary-eventloop.jsonl).
- Representativo: [probe](large-candidate-representative-probe.json),
  [cliente](large-candidate-representative-client.json),
  [recursos](large-candidate-representative-resources.csv),
  [disco](large-candidate-representative-disk.csv) e
  [event loop](large-candidate-representative-eventloop.jsonl).

## Remediação corrente, 18–20/11/2026

Os dois ensaios foram repetidos depois das correções funcionais, sem reutilizar
o aceite de 17/11. A espera natural do JWT foi separada das janelas de request;
o probe independente mediu baseline, PUT ativo, pausa, retomada e processing.
O worker permaneceu em 2 CPUs/1 GiB, sem afinidade fixa.

| Métrica do probe/host | Fronteira 10 GB | Representativo 9,1 GB |
| --- | ---: | ---: |
| Bytes / SHA-256 | 10.000.000.000 / `ebd7cc0d…58fdbe` | 9.104.679.495 / `6496dedb…e39231` |
| Pausa natural de expiração | 837,663 s | 832,017 s |
| Upload total / atividade aproximada | 881,034 s / 43,371 s | 984,209 s / 152,192 s |
| Processing até `ready` | 59,257 s | 400,118 s |
| Baseline p95 | 5,815 ms (60) | 8,805 ms (60) |
| PUT ativo p95 / razão | 6,297 ms / 1,08× (3) | 3,241 ms / 0,37× (32) |
| Pausa p95 / razão | 3,736 ms / 0,64× (833) | 4,250 ms / 0,48× (167) |
| Retomada p95 / razão | 8,854 ms / 1,52× (41) | 3,284 ms / 0,37× (139) |
| Processing p95 / razão | 5,349 ms / 0,92× (58) | 3,237 ms / 0,37× (399) |
| Erros probe/cliente | 0 / 0 | 0 / 0 |
| API RSS min→máx | 103,2→120,4 MiB | 106,5→149,8 MiB |
| Worker RSS min→máx | 69,77→333,3 MiB | 100,1→566,1 MiB |
| Event loop p95 máximo / pico | 1,920 / 339,214 ms (202 janelas) | 1,531 / 229,638 ms (307 janelas) |
| Scratch pico | 10.000.012.288 bytes | 18.209.389.206 bytes |
| MinIO pico | 10.134.454.292 bytes | 18.210.204.632 bytes |

Ambos terminaram `ready`, com H.264 yuv420p 3840×2160 a 25 fps. O
representativo preservou os 9.104.679.495 bytes do payload audiovisual, duração
de 680.000 ms e ausência de áudio. A verificação posterior autenticou novamente,
baixou fonte e stream com o mesmo tamanho e SHA-256, confirmou Range 206/416,
seek 206, HEAD 200 e thumbnail JPEG de 17.928 bytes. Os p95 ficaram abaixo de
500 ms e de 2× o baseline, a taxa de erro foi 0% e a variação de RSS da API
ficou muito abaixo de 128 MiB.

As tentativas reprovadas não foram apagadas. Uma execução inicial excedeu a
razão relativa; duas cadências posteriores produziram respostas 429; outra foi
abortada durante preparação; e a repetição `certified` de 20/11 foi interrompida
por reinício externo do Docker Desktop durante processing. Esta última preserva
CSV de recursos/disco e 293 janelas de event loop, mas não é usada como aceite.
Os nomes `*-failed-*`, `*-aborted-*` e `*-interrupted-*` mantêm essas evidências.

Dados brutos aprovados desta remediação:

- Fronteira: [probe](large-remediation-boundary-probe.json),
  [cliente](large-remediation-boundary-client.json),
  [recursos](large-remediation-boundary-resources.csv),
  [disco](large-remediation-boundary-disk.csv) e
  [event loop](large-remediation-boundary-eventloop.jsonl).
- Representativo: [probe](large-remediation-representative-certified-final-probe.json),
  [cliente](large-remediation-representative-certified-final-client.json),
  [delivery](large-remediation-representative-certified-final-delivery.json),
  [recursos](large-remediation-representative-certified-final-resources.csv),
  [disco](large-remediation-representative-certified-final-disk.csv) e
  [event loop](large-remediation-representative-certified-final-eventloop.jsonl).

Os três JSONs aprovados, 307 linhas JSONL e os dois CSVs do representativo foram
parseados após a execução. A varredura por JWT, refresh token, signed query,
chaves AWS/GitHub/Slack e private keys não encontrou correspondência nesses
arquivos.
