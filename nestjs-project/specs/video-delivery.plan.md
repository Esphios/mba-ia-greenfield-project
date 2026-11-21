---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: nestjs-project/test/video-delivery.e2e-spec.ts
---

# Video Delivery Test Plan

## Application Overview

Preview/download/thumbnail privados por URLs estáveis e redirecionamento assinado.
Contrato do SI-03.12, sem implementar player ou frontend.

### Regressões da auditoria de 16/11

| Contrato | Caminho executável |
| --- | --- |
| 307/HEAD/Range e hash do original | `test/video-delivery.e2e-spec.ts` |
| privacidade, estados e URLs sem cache | `test/video-delivery.e2e-spec.ts`, `src/videos/video-delivery.service.spec.ts` |
| canonical URL absoluta e Host não confiável | `test/video-upload.e2e-spec.ts`, `src/config/video.config.spec.ts` |
| OpenAPI/status/headers/nullables | `openapi.json`, `test/video-delivery.e2e-spec.ts` |

As verificações seguem redirecionamentos e observam resposta/storage; não
inspecionam implementação privada do serviço.

### Remediação corrente de 18–20/11

Os ensaios grandes correntes verificaram redirect 307, stream/download, HEAD,
Range 206/416, thumbnail, tamanhos e hashes sobre storage privado. Evidências
estão em `docs/phases/phase-03-videos/evidence/large-trials.md`; a primeira
passagem integral e suas contagens estão em
`docs/phases/phase-03-videos/evidence/remediation-2026-11-18.md`. A certificação
local do candidato integrado e congelado repetiu os gates e foi publicado no fork.

## Test Scenarios

### 1. GET e HEAD /videos/:publicId/stream, download e thumbnail

**Setup:** Upload real de MP4 pequeno até ready, dono e usuário adverso; storage
privado real e endpoint público alcançável pelo cliente de testes. Não logar URLs.

#### 1.1. range-seek-e-inicio-progressivo

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Pedir stream como dono, seguir 307 com Range bytes=0-1023.
   - expect: Cache-Control no-store no redirect; 206, 1024 bytes e Content-Range.
2. Solicitar segundo trecho e range além do fim.
   - expect: segundo 206 com bytes esperados; depois 416.
3. Inspecionar MP4 de stream e iniciar consumo incremental.
   - expect: moov antes de mdat; parser inicia sem exigir arquivo completo.

#### 1.2. head-e-download-original

**Covers AC:** #2, #3
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Chamar HEAD explícito de stream/download/thumbnail e seguir como HEAD.
   - expect: assinatura válida de HEAD, status e metadados sem body.
2. Baixar original e comparar hash com fixture.
   - expect: igualdade byte a byte, attachment com filename sem CR/LF ou caminhos.
3. Buscar thumbnail como dono.
   - expect: JPEG válido e largura máxima 640 com proporção preservada.

#### 1.3. privacidade-expiracao-e-estado

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T21:22:00Z

**Steps:**
1. Chamar rotas como anônimo, outro dono e dono de vídeo draft/processing/error.
   - expect: 401, 404 e 409 respectivamente, sem URL assinada.
2. Acessar objeto sem assinatura e iniciar nova requisição com assinatura expirada.
   - expect: storage recusa; dono consegue nova URL pela rota estável. Não exigir
     interrupção de transferência iniciada antes da expiração.
3. Comparar publicId antes/depois de nova assinatura.
   - expect: identidade canônica permanece igual.
