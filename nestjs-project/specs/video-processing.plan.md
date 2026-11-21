---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.13
target_file: nestjs-project/test/video-processing.e2e-spec.ts
---

# Video Processing Test Plan

## Application Overview

Fluxo HTTP→storage→DB/outbox→fila→worker→mídia, incluindo recuperação real. Os
cenários têm evidência executável nos caminhos abaixo. O ensaio de 10 GB é
separado (SI-03.14) e sua evidência permanece versionada na pasta da fase.

### Regressões da auditoria de 16/11

| Contrato | Caminho executável |
| --- | --- |
| deadline total, abort, perda de lease e CAS tardio | `src/videos/processing/video-processor.service.spec.ts`, `src/videos/processing/video-processor.integration-spec.ts` |
| cleanup terminal, efeitos tardios e quota | `src/videos/processing/processing-recovery.integration-spec.ts` |
| outbox saturada e Redis indisponível/recuperado | `src/videos/processing/outbox.integration-spec.ts` |
| taxonomia de mídia e protocolos locais | `src/videos/processing/video-processor.integration-spec.ts` |
| worker readiness/shutdown e runtime | `src/videos/processing/video-worker.integration-spec.ts`, `src/videos/processing/video-worker-runtime.service.spec.ts` |
| streams limitados e multipart abortado | `src/storage/storage.service.spec.ts`, `src/storage/storage.service.integration-spec.ts` |

Os testes condicionais usam `VIDEO_WORKER_INTEGRATION=1`; sem essa variável o
skip é intencional e não conta como execução do perfil FFmpeg real.

### Remediação corrente de 18–20/11

A primeira passagem integral executou 316 testes padrão, 92 e2e, 14 integrações
FFmpeg e 2 e2e de worker. Os dois ensaios grandes correntes chegaram a `ready` e
publicaram recursos, disco e event loop. Evidências estão em
`docs/phases/phase-03-videos/evidence/remediation-2026-11-18.md` e
`docs/phases/phase-03-videos/evidence/large-trials.md`; a certificação local do
candidato integrado e congelado repetiu os mesmos gates e foi publicado no fork.

## Test Scenarios

### 1. Upload completo e processamento automático

**Setup:** API, PostgreSQL, Redis, MinIO e FFmpeg reais, worker standalone de teste
com recursos e namespaces isolados. Fixtures válidas/corrompidas. Falhas induzidas
no ambiente de teste com failpoints exclusivos; sem modificar dados de dev.

#### 1.1. ciclo-completo-e-regressao

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Fazer cadastro/auth existente e iniciar upload direto do MP4.
   - expect: auth funciona e draft aparece antes dos bytes.
2. Concluir e observar via GET até terminal, com polling limitado.
   - expect: processing→ready, metadados e dois derivados confirmados.
3. Executar suite existente auth/migrations e verificar isolamento.
   - expect: suite verde e dados dev inalterados.

#### 1.2. erro-definitivo-e-retries

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Completar arquivos sem vídeo, corrompidos no início e depois do frame de thumbnail,
   incluindo corrupção no áudio selecionado e duração/fps inválidos.
   - expect: INVALID_VIDEO sem retry, após validação de demux/decode integral para
     saída nula; mídia indisponível e nenhum ready parcial.
   Completar arquivo com codec não suportado, segundo vídeo/áudio, capa/legenda/dados.
   - expect: UNSUPPORTED_VIDEO sem retry; seleção automática FFmpeg não é usada.
2. Induzir falha transitória de storage/processo nas tentativas.
   - expect: até três claims no banco; depois error, sem processamento eterno.
3. Reentregar evento terminal.
   - expect: estado/metadados invariantes e nenhum novo processamento.

#### 1.3. crash-fila-indisponivel-e-fencing

**Covers AC:** #1, #2, #3
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Parar Redis, concluir upload, reiniciar Redis.
   - expect: intenção persistida e processamento automático após recuperação.
2. Induzir crash após complete S3 antes de commit e após publish antes de ack DB.
   - expect: reconciliação encontra objeto/job, sem outro vídeo/evento lógico.
3. Matar worker durante tentativa e iniciar outro após lease vencer.
   - expect: recuperação respeita orçamento DB e resultado vencedor único.
4. Simular tentativa antiga tentando finalizar após perda de lease.
   - expect: CAS rejeita e cleanup não remove os objetos vencedores.
5. Remover job no Redis de teste após publicação mantendo outbox não finalizada.
   - expect: republicação automática sem reset de attempts.
6. Entregar job com lease ocupada e simular retry antes de vencer backoff.
   - expect: adiamento sem sucesso terminal e sem consumir claim DB.
7. Manter a terceira tentativa saudável durante sweep e falhar um transporte antes do terceiro claim.
   - expect: lease válida preservada; job terminal de transporte recuperado enquanto há orçamento DB.
8. Confirmar commit ready no banco e perder sua resposta; repetir CAS/finalização.
   - expect: releitura reconhece attemptId/keys vencedoras e preserva os objetos.
   Repetir com banco indisponível na releitura.
   - expect: cleanup adiado, sem inferir rollback ou deletar referências vencedoras.
9. Finalizar vídeo/abortar sessão com cleanup indisponível e depois restaurá-lo.
   - expect: quota retida até terminal + limpeza confirmada; liberação única e
     observável. Original completed é preservado inclusive no estado error.

#### 1.4. metadados-selecao-e-deadlines

**Covers AC:** #1, #2
**Source:** review-2026-11-09
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Processar vídeo sem áudio e vídeo com único áudio AAC; controlar índices das tracks.
   - expect: validação/remux/thumbnail usam os mesmos índices explícitos; metadata
     contém format mp4, videoCodec h264, audioCodec aac|null, dimensões inteiras,
     fps racional positivo de avg_frame_rate e durationMs arredondado ao ms seguro.
     Em draft/processing, duração/metadata permanecem null; ready publica juntos.
2. Exceder tempo de decode ou deadline total incluindo download/remux/upload.
   - expect: PROCESSING_TIMEOUT; limite total 90min prevalece, processos param,
     scratch é limpo e retry segue orçamento DB. Usar relógios/timeouts de teste
     isolados para cenários curtos, sem alegar ensaio real de 90min.
3. Validar liberação de reserva após cleanup imediato e recuperação de órfão antigo.
   - expect: proteger lease ativa/keys vencedoras; fallback de 24h não impede
     limpeza imediata de tentativa comprovadamente terminalizada.
