const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream, writeFileSync, openSync, closeSync, writeSync, ftruncateSync, statSync } = require('node:fs');
const { join } = require('node:path');

const directory = process.env.VIDEO_LARGE_FIXTURE_DIR ?? '/work/fixtures';
const sample = join(directory, 'sample.mp4');
const representative = join(directory, 'representative.mp4');
const boundary = join(directory, 'boundary-10gb.mp4');

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,avg_frame_rate,duration', '-of', 'json', file,
  ], { maxBuffer: 1024 * 1024 }).toString());
}

function packetPayload(file) {
  const output = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=size', '-of', 'csv=p=0', file,
  ], { maxBuffer: 20 * 1024 * 1024 }).toString();
  return output.split(/\r?\n/).reduce((sum, line) => sum + (Number(line) || 0), 0);
}

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function main() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Large fixtures require test mode');
  if (!statSync(directory).isDirectory()) throw new Error('Missing fixture volume');
  if (!statSync(sample, { throwIfNoEntry: false })) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=3840x2160:rate=25', '-t', '10', '-c:v', 'libx264',
      '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an', '-y', sample,
    ], { stdio: 'inherit', timeout: 180_000 });
  }
  const samplePayload = packetPayload(sample);
  const repeats = Math.ceil(9_000_000_000 / samplePayload);
  if (repeats * statSync(sample).size > 10_000_000_000)
    throw new Error('Representative exceeds 10GB; adjust sample');
  const list = join(directory, 'representative-concat.txt');
  writeFileSync(list, Array(repeats).fill(`file '${sample}'`).join('\n') + '\n');
  if (!statSync(representative, { throwIfNoEntry: false })) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
      '-i', list, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart',
      '-y', representative,
    ], { stdio: 'inherit', timeout: 1_800_000 });
  }
  const source = statSync(sample).size;
  if (source > 10_000_000_000 - 16) throw new Error('Sample too large');
  if (!statSync(boundary, { throwIfNoEntry: false })) {
    const fd = openSync(boundary, 'w');
    try {
      const bytes = require('node:fs').readFileSync(sample);
      writeSync(fd, bytes, 0, bytes.length, 0);
      const remaining = 10_000_000_000 - bytes.length;
      const header = Buffer.alloc(16);
      header.writeUInt32BE(1, 0);
      header.write('free', 4, 'ascii');
      header.writeBigUInt64BE(BigInt(remaining), 8);
      writeSync(fd, header, 0, header.length, bytes.length);
      ftruncateSync(fd, 10_000_000_000);
    } finally { closeSync(fd); }
  }
  const representativeBytes = statSync(representative).size;
  const payload = packetPayload(representative);
  if (representativeBytes > 10_000_000_000 || payload < 9_000_000_000)
    throw new Error(`Representative bounds failed: ${representativeBytes}/${payload}`);
  if (statSync(boundary).size !== 10_000_000_000)
    throw new Error('Boundary size mismatch');
  console.log(JSON.stringify({
    boundary: { bytes: 10_000_000_000, sha256: await hash(boundary), probe: probe(boundary) },
    representative: { bytes: representativeBytes, packetPayloadBytes: payload,
      repeats, sha256: await hash(representative), probe: probe(representative) },
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
