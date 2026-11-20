const { readFileSync, writeFileSync } = require('node:fs');
const { STAGES, summarizeSamples } = require('./video-large-report.cjs');

const signal = process.env.VIDEO_LARGE_SIGNAL_FILE;
const metrics = process.env.VIDEO_LARGE_PROBE_METRICS_FILE;
const api = process.env.VIDEO_LARGE_API_URL ?? 'http://nestjs-api-test:3000';
const samples = Object.fromEntries(STAGES.map((stage) => [stage, []]));
const errors = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSignal() {
  try {
    return JSON.parse(readFileSync(signal, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'streamtube_phase03_test' ||
    !signal ||
    !metrics
  )
    throw new Error('Isolated probe configuration required');
  let state;
  for (let i = 0; i < 6000; i++) {
    state = readSignal();
    if (state?.publicId) break;
    await sleep(100);
  }
  if (!state?.publicId) throw new Error('Client did not signal a video');
  if (!state.probeAuth?.accessToken || !state.probeAuth?.refreshToken)
    throw new Error('Probe login session was not signalled');
  let token = state.probeAuth.accessToken;
  let refreshToken = state.probeAuth.refreshToken;
  let refreshedAt = Date.now();
  while (true) {
    state = readSignal();
    if (!state || state.stage === 'done') break;
    const stage = state.stage;
    if (!samples[stage]) throw new Error(`Unknown stage: ${stage}`);
    if (Date.now() - refreshedAt > 12 * 60_000) {
      const rotated = await fetch(new URL('/auth/refresh', api), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!rotated.ok)
        throw new Error(`Probe refresh rotation failed: ${rotated.status}`);
      const body = await rotated.json();
      token = body.access_token;
      refreshToken = body.refresh_token;
      refreshedAt = Date.now();
    }
    const started = performance.now();
    const response = await fetch(new URL(`/videos/${state.publicId}`, api), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ms = performance.now() - started;
    await response.arrayBuffer();
    const sample = {
      at: new Date().toISOString(),
      ms,
      status: response.status,
    };
    samples[stage].push(sample);
    if (!response.ok) errors.push({ stage, ...sample });
    const intervalMs =
      stage === 'uploadActive'
        ? 250
        : stage === 'expirationPause'
          ? 5000
          : 1000;
    await sleep(intervalMs);
  }
  const summary = summarizeSamples(samples);
  const report = { publicId: state?.publicId, summary, errors, samples };
  writeFileSync(metrics, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ publicId: state?.publicId, summary, errors }));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
