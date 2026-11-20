const { createHash, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const argon2 = require('argon2');

const api = process.env.VIDEO_LARGE_API_URL ?? 'http://nestjs-api-test:3000';
const publicId = process.env.VIDEO_LARGE_PUBLIC_ID;
const sourceSha256 = process.env.VIDEO_LARGE_SOURCE_SHA256;

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'streamtube_phase03_test')
    throw new Error('Large verification requires isolated test DB');
  if (!publicId || !sourceSha256) throw new Error('Public ID and source hash required');
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await db.connect();
  let video;
  const verificationPassword = randomUUID();
  try {
    const target = await db.query('SELECT current_database() AS name');
    if (target.rows[0].name !== 'streamtube_phase03_test') throw new Error('Wrong database');
    const rows = await db.query(`SELECT v.status,v.size_bytes,u.id AS user_id,u.email
      FROM videos v JOIN channels c ON c.id=v.channel_id JOIN users u ON u.id=c.user_id
      WHERE v.public_id=$1`, [publicId]);
    video = rows.rows[0];
    if (video) {
      await db.query('UPDATE users SET password=$1 WHERE id=$2', [
        await argon2.hash(verificationPassword),
        video.user_id,
      ]);
    }
  } finally { await db.end(); }
  if (!video || video.status !== 'ready') throw new Error('Video is not ready');
  const login = await fetch(new URL('/auth/login', api), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: video.email, password: verificationPassword }),
  });
  if (!login.ok) throw new Error(`Verification login failed: ${login.status}`);
  const token = (await login.json()).access_token;
  const authorization = { Authorization: `Bearer ${token}` };

  async function location(kind, method = 'GET') {
    const response = await fetch(new URL(`/videos/${publicId}/${kind}`, api),
      { method, headers: authorization, redirect: 'manual' });
    if (response.status !== 307 || response.headers.get('cache-control') !== 'no-store')
      throw new Error(`${kind}/${method} redirect failed: ${response.status}`);
    return response.headers.get('location');
  }

  const stream = await location('stream');
  const first = await fetch(stream, { headers: { Range: 'bytes=0-1023' } });
  const firstBytes = Buffer.from(await first.arrayBuffer());
  const streamBytes = Number(first.headers.get('content-range')?.split('/')[1]);
  if (first.status !== 206 || firstBytes.length !== 1024 ||
      !Number.isSafeInteger(streamBytes) || streamBytes < 1024)
    throw new Error(`Initial range failed: ${first.status}/${firstBytes.length}`);
  const seek = await fetch(stream, { headers: { Range: 'bytes=1048576-1049599' } });
  if (seek.status !== 206 || (await seek.arrayBuffer()).byteLength !== 1024)
    throw new Error('Seek range failed');
  const invalid = await fetch(stream, { headers: { Range: `bytes=${streamBytes}-` } });
  if (invalid.status !== 416) throw new Error('Out-of-range request did not return 416');
  for (const kind of ['stream', 'download', 'thumbnail']) {
    const signedHead = await location(kind, 'HEAD');
    const head = await fetch(signedHead, { method: 'HEAD' });
    if (head.status !== 200) throw new Error(`${kind} HEAD returned ${head.status}`);
  }
  const download = await fetch(await location('download'));
  if (download.status !== 200 || !download.headers.get('content-disposition')?.includes('attachment'))
    throw new Error('Download failed');
  const digest = createHash('sha256');
  let downloadedBytes = 0;
  for await (const chunk of download.body) {
    digest.update(chunk);
    downloadedBytes += chunk.length;
  }
  if (downloadedBytes !== Number(video.size_bytes) || digest.digest('hex') !== sourceSha256)
    throw new Error('Downloaded source hash or size mismatch');
  const image = await fetch(await location('thumbnail'));
  const jpeg = Buffer.from(await image.arrayBuffer());
  if (image.status !== 200 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
      jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9)
    throw new Error('Thumbnail is not JPEG');
  console.log(JSON.stringify({ publicId, sourceBytes: downloadedBytes, streamBytes,
    sourceSha256, streamRange: 206, seekRange: 206, invalidRange: 416,
    head: 200, thumbnailBytes: jpeg.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
