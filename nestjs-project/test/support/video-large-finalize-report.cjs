const { readFileSync, writeFileSync } = require('node:fs');
const { summarizeSamples } = require('./video-large-report.cjs');

const file = process.argv[2];
if (!file) throw new Error('Report path is required');
const report = JSON.parse(readFileSync(file, 'utf8'));
if (!report.samples || typeof report.samples !== 'object') {
  throw new Error('Report has no raw samples');
}
report.latency = summarizeSamples(report.samples);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.latency));
