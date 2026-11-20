const {
  createReadStream,
  statSync,
  writeFileSync,
  renameSync,
} = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { request: httpRequest } = require('node:http');
const { Transform } = require('node:stream');
const { Client } = require('pg');
const argon2 = require('argon2');
const { STAGES, summarizeSamples } = require('./video-large-report.cjs');

const api = process.env.VIDEO_LARGE_API_URL ?? 'http://nestjs-api-test:3000';
const fixture = process.env.VIDEO_LARGE_FILE;
const label = process.env.VIDEO_LARGE_LABEL ?? 'large';
const partBytes = 67_108_864;
const putMiBpsPerPart = Number(process.env.VIDEO_LARGE_PUT_MIBPS ?? 0);
const results = {
  label,
  samples: Object.fromEntries(STAGES.map((stage) => [stage, []])),
  errors: 0,
  errorDetails: [],
  stageWindows: {},
};
let accessToken;
let refreshToken;
let lastRefresh = 0;
let stagePublicId;
let probeAuth;
let probeAuthPending = true;

function tokenExpirationMs(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Access token has no JWT payload');
  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  );
  if (!Number.isFinite(decoded.exp)) throw new Error('Access token has no exp');
  return decoded.exp * 1000;
}

function signalStage(stage) {
  const file = process.env.VIDEO_LARGE_SIGNAL_FILE;
  if (!file || !stagePublicId) return;
  const temporary = `${file}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({
      stage,
      publicId: stagePublicId,
      at: new Date().toISOString(),
      ...(probeAuthPending ? { probeAuth } : {}),
    }),
  );
  renameSync(temporary, file);
  probeAuthPending = false;
}

async function apiRequest(method, path, body, auth = true) {
  if (auth && Date.now() - lastRefresh > 12 * 60_000) await rotateRefresh();
  const start = performance.now();
  const response = await fetch(new URL(path, api), {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'POST' && path === '/videos'
        ? { 'Idempotency-Key': results.idempotencyKey }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const elapsedMs = performance.now() - start;
  if (
    path.startsWith('/videos/') &&
    method === 'GET' &&
    !path.endsWith('/upload')
  ) {
    results.samples[results.stage].push({
      ms: elapsedMs,
      status: response.status,
    });
  }
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) {
    results.errors++;
    results.errorDetails.push({
      stage: results.stage,
      method,
      path,
      status: response.status,
      at: new Date().toISOString(),
    });
    throw new Error(
      `API ${method} ${path}: ${response.status} ${JSON.stringify(value)}`,
    );
  }
  return { value, status: response.status, elapsedMs };
}

async function measureDeliveryRedirect(publicId) {
  const start = performance.now();
  const response = await fetch(new URL(`/videos/${publicId}/stream`, api), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'manual',
  });
  const elapsedMs = performance.now() - start;
  results.samples.delivery.push({ ms: elapsedMs, status: response.status });
  if (response.status !== 307) {
    results.errors++;
    throw new Error(`Delivery redirect returned ${response.status}`);
  }
  return response.status;
}

async function rotateRefresh() {
  if (!refreshToken) return;
  const response = await fetch(new URL('/auth/refresh', api), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok)
    throw new Error(`Refresh rotation failed: ${response.status}`);
  const rotated = await response.json();
  accessToken = rotated.access_token;
  refreshToken = rotated.refresh_token;
  lastRefresh = Date.now();
  results.refreshRotations = (results.refreshRotations ?? 0) + 1;
}

async function putPart(url, start, length) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'PUT',
        headers: { 'Content-Length': length },
      },
      (incoming) => {
        incoming.resume();
        incoming.on('end', () => {
          if (incoming.statusCode === 200) resolve();
          else reject(new Error(`Signed PUT returned ${incoming.statusCode}`));
        });
      },
    );
    outgoing.on('error', reject);
    const source = createReadStream(fixture, {
      start,
      end: start + length - 1,
      highWaterMark: 1024 * 1024,
    }).on('error', reject);
    if (putMiBpsPerPart > 0) {
      const bytesPerSecond = putMiBpsPerPart * 1024 * 1024;
      let nextChunkAt = performance.now();
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          const now = performance.now();
          const sendAt = Math.max(now, nextChunkAt);
          nextChunkAt = sendAt + (chunk.length / bytesPerSecond) * 1000;
          setTimeout(() => callback(null, chunk), Math.max(0, sendAt - now));
        },
      }).on('error', reject);
      source.pipe(limiter).pipe(outgoing);
    } else {
      source.pipe(outgoing);
    }
  });
}

async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function seedActor() {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'streamtube_phase03_test'
  )
    throw new Error('Large client requires isolated phase 03 test DB');
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();
  try {
    const target = await db.query('SELECT current_database() AS name');
    if (target.rows[0].name !== 'streamtube_phase03_test')
      throw new Error('Wrong database');
    const userId = randomUUID();
    const channelId = randomUUID();
    const email = `${userId}@large-video.test`;
    const password = randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password,is_confirmed) VALUES($1,$2,$3,true)',
      [userId, email, await argon2.hash(password)],
    );
    await db.query(
      'INSERT INTO channels(id,name,nickname,user_id) VALUES($1,$2,$3,$4)',
      [channelId, 'Large video test', `large-${channelId}`, userId],
    );
    return { email, password, userId };
  } finally {
    await db.end();
  }
}

async function waitForApi() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(new URL('/auth/login', api));
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API did not start');
}

async function run() {
  if (!fixture) throw new Error('VIDEO_LARGE_FILE is required');
  if (
    !Number.isFinite(putMiBpsPerPart) ||
    putMiBpsPerPart < 0 ||
    putMiBpsPerPart > 1024
  )
    throw new Error(
      `Invalid VIDEO_LARGE_PUT_MIBPS: ${process.env.VIDEO_LARGE_PUT_MIBPS}`,
    );
  const size = statSync(fixture).size;
  if (size > 10_000_000_000 || size < 9_000_000_000)
    throw new Error(`Wrong fixture size: ${size}`);
  results.bytes = size;
  results.putMiBpsPerPart = putMiBpsPerPart || null;
  results.sourceSha256 = await hashFile(fixture);
  await waitForApi();
  const actor = await seedActor();
  const login = await apiRequest(
    'POST',
    '/auth/login',
    { email: actor.email, password: actor.password },
    false,
  );
  accessToken = login.value.access_token;
  refreshToken = login.value.refresh_token;
  lastRefresh = Date.now();
  const issuedAccessExpiration = tokenExpirationMs(accessToken);
  const probeLogin = await apiRequest(
    'POST',
    '/auth/login',
    { email: actor.email, password: actor.password },
    false,
  );
  probeAuth = {
    accessToken: probeLogin.value.access_token,
    refreshToken: probeLogin.value.refresh_token,
  };
  results.idempotencyKey = randomUUID();
  results.stage = 'baseline';
  results.stageWindows.baselineStart = new Date().toISOString();
  const created = await apiRequest('POST', '/videos', {
    title: `Large video ${label}`,
    filename: `${label}.mp4`,
    sizeBytes: size,
    contentType: 'video/mp4',
  });
  const publicId = created.value.video.publicId;
  stagePublicId = publicId;
  results.publicId = publicId;
  signalStage('baseline');
  for (let i = 0; i < 60; i++) {
    await apiRequest('GET', `/videos/${publicId}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  results.stageWindows.baselineEnd = new Date().toISOString();
  results.stage = 'uploadActive';
  signalStage('uploadActive');
  results.stageWindows.uploadActiveStart = new Date().toISOString();
  const count = Math.ceil(size / partBytes);
  let stopped = false;
  const statusTimer = setInterval(() => {
    if (stopped || !['uploadActive', 'resume'].includes(results.stage)) return;
    void apiRequest('GET', `/videos/${publicId}`).catch(() => {});
  }, 1000);
  const uploadStart = Date.now();
  try {
    const completed = new Set();
    const interruptionPoint = Math.min(8, count);
    for (let i = 1; i <= interruptionPoint; i += 4) {
      const numbers = Array.from(
        { length: Math.min(4, interruptionPoint - i + 1) },
        (_, offset) => i + offset,
      );
      const signed = await apiRequest(
        'POST',
        `/videos/${publicId}/upload/parts`,
        { partNumbers: numbers },
      );
      await Promise.all(
        signed.value.parts.map(async (part) => {
          const start = (part.partNumber - 1) * partBytes;
          await putPart(part.url, start, part.expectedSizeBytes);
          completed.add(part.partNumber);
        }),
      );
    }
    stopped = true;
    results.stageWindows.uploadActiveEnd = new Date().toISOString();
    results.stage = 'expirationPause';
    signalStage('expirationPause');
    results.stageWindows.expirationPauseStart = new Date().toISOString();
    const expirationWaitMs = Math.max(
      0,
      issuedAccessExpiration - Date.now() + 1500,
    );
    results.naturalExpirationWaitSeconds = expirationWaitMs / 1000;
    await new Promise((resolve) => setTimeout(resolve, expirationWaitMs));
    const expired = await fetch(new URL(`/videos/${publicId}/upload`, api), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (expired.status !== 401)
      throw new Error(`Expected expired JWT 401, got ${expired.status}`);
    results.expiredJwtRejected = true;
    await rotateRefresh();
    results.stageWindows.expirationPauseEnd = new Date().toISOString();
    results.stage = 'resume';
    signalStage('resume');
    results.stageWindows.resumeStart = new Date().toISOString();
    stopped = false;
    const persisted = await apiRequest('GET', `/videos/${publicId}/upload`);
    for (const part of persisted.value.uploadedParts)
      completed.add(part.partNumber);
    results.resumedParts = completed.size;
    for (let i = 1; i <= count; i += 4) {
      const numbers = Array.from(
        { length: Math.min(4, count - i + 1) },
        (_, offset) => i + offset,
      ).filter((number) => !completed.has(number));
      if (!numbers.length) continue;
      const signed = await apiRequest(
        'POST',
        `/videos/${publicId}/upload/parts`,
        { partNumbers: numbers },
      );
      await Promise.all(
        signed.value.parts.map(async (part) => {
          const start = (part.partNumber - 1) * partBytes;
          await putPart(part.url, start, part.expectedSizeBytes);
        }),
      );
    }
    const accepted = await apiRequest(
      'POST',
      `/videos/${publicId}/upload/completion`,
    );
    if (accepted.status !== 202 || accepted.value.status !== 'processing')
      throw new Error('Completion did not enter processing');
    results.uploadSeconds = (Date.now() - uploadStart) / 1000;
    results.stageWindows.resumeEnd = new Date().toISOString();
    results.stage = 'processing';
    signalStage('processing');
    results.stageWindows.processingStart = new Date().toISOString();
    const processingStart = Date.now();
    for (;;) {
      const current = await apiRequest('GET', `/videos/${publicId}`);
      if (
        current.value.status === 'ready' ||
        current.value.status === 'error'
      ) {
        results.status = current.value.status;
        results.failureCode = current.value.failureCode;
        results.durationMs = current.value.durationMs;
        results.metadata = current.value.metadata;
        break;
      }
      if (Date.now() - processingStart > 90 * 60_000)
        throw new Error('Processing exceeded 90 minutes');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    results.processingSeconds = (Date.now() - processingStart) / 1000;
    results.stageWindows.processingEnd = new Date().toISOString();
    results.stage = 'delivery';
    signalStage('delivery');
    results.stageWindows.deliveryStart = new Date().toISOString();
    results.deliveryRedirectStatus = await measureDeliveryRedirect(publicId);
    results.stageWindows.deliveryEnd = new Date().toISOString();
    signalStage('done');
    results.latency = summarizeSamples(results.samples);
    if (process.env.VIDEO_LARGE_METRICS_FILE) {
      writeFileSync(
        process.env.VIDEO_LARGE_METRICS_FILE,
        JSON.stringify(results, null, 2) + '\n',
      );
    }
    delete results.samples;
    delete results.idempotencyKey;
    console.log(JSON.stringify(results));
    if (results.status !== 'ready')
      throw new Error(`Large video ended ${results.status}`);
  } finally {
    stopped = true;
    clearInterval(statusTimer);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
