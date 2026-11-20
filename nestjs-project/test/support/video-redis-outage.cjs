const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const api = process.env.VIDEO_LARGE_API_URL ?? 'http://nestjs-api-test:3000';
const barrier = '/work/fixtures/redis-outage';
const source = readFileSync('test/fixtures/delivery.mp4');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(name) {
  for (let i = 0; i < 120; i++) {
    if (existsSync(`${barrier}-${name}`)) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${name}`);
}
async function call(method, path, token, body, extra = {}) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: { Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return { status: response.status, value };
}

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'streamtube_phase03_test')
    throw new Error('Disposable phase 03 database required');
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await db.connect();
  try {
    const target = await db.query('SELECT current_database() AS name');
    if (target.rows[0].name !== 'streamtube_phase03_test') throw new Error('Wrong database');
    const userId = randomUUID();
    const channelId = randomUUID();
    const email = `${userId}@redis-outage.test`;
    await db.query('INSERT INTO users(id,email,password,is_confirmed) VALUES($1,$2,$3,true)',
      [userId, email, 'test-only']);
    await db.query('INSERT INTO channels(id,name,nickname,user_id) VALUES($1,$2,$3,$4)',
      [channelId, 'Redis outage test', `redis-${channelId}`, userId]);
    const token = jwt.sign({ sub: userId, email }, process.env.JWT_SECRET,
      { expiresIn: '15m' });
    const created = await call('POST', '/videos', token, {
      title: 'Redis outage test', filename: 'delivery.mp4', sizeBytes: source.length,
      contentType: 'video/mp4',
    }, { 'Idempotency-Key': randomUUID() });
    const publicId = created.value.video.publicId;
    const signed = await call('POST', `/videos/${publicId}/upload/parts`, token,
      { partNumbers: [1] });
    const put = await fetch(signed.value.parts[0].url, { method: 'PUT', body: source });
    if (put.status !== 200) throw new Error(`Signed PUT returned ${put.status}`);
    writeFileSync(`${barrier}-ready`, publicId);
    console.log('READY_TO_STOP_REDIS');
    await waitFor('complete');
    const completed = await call('POST', `/videos/${publicId}/upload/completion`, token);
    if (completed.status !== 202 || completed.value.status !== 'processing')
      throw new Error('Completion did not persist processing');
    const rows = await db.query(`SELECT v.status,o.published_at,o.finalized_at
      FROM videos v JOIN video_processing_outbox o ON o.video_id=v.id
      WHERE v.public_id=$1`, [publicId]);
    if (rows.rows.length !== 1 || rows.rows[0].status !== 'processing' ||
        rows.rows[0].published_at || rows.rows[0].finalized_at)
      throw new Error('Outbox intent was not durably pending while Redis was down');
    writeFileSync(`${barrier}-pending`, publicId);
    console.log('PENDING_WITH_REDIS_DOWN');
    await waitFor('restarted');
    for (let i = 0; i < 120; i++) {
      const current = await call('GET', `/videos/${publicId}`, token);
      if (current.value.status === 'ready') {
        const [row] = (await db.query(`SELECT v.status,v.processing_attempts,
          o.published_at,o.finalized_at FROM videos v
          JOIN video_processing_outbox o ON o.video_id=v.id
          WHERE v.public_id=$1`, [publicId])).rows;
        if (!row.published_at || !row.finalized_at || row.processing_attempts !== 1)
          throw new Error('Recovered processing did not finalize one event/claim');
        console.log(JSON.stringify({ publicId, status: row.status,
          processingAttempts: row.processing_attempts, outboxPublished: true,
          outboxFinalized: true }));
        return;
      }
      if (current.value.status === 'error') throw new Error('Recovered video failed');
      await sleep(1000);
    }
    throw new Error('Redis recovery did not reach ready');
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
