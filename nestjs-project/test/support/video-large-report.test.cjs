const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGES, summarizeSamples } = require('./video-large-report.cjs');

test('summarizes request durations independently from stage wall-clock waits', () => {
  const samples = Object.fromEntries(STAGES.map((stage) => [stage, []]));
  samples.uploadActive.push({ ms: 20, status: 200 }, { ms: 40, status: 200 });
  samples.expirationPause.push({ ms: 5, status: 200 });
  samples.resume.push({ ms: 10, status: 200 }, { ms: 15, status: 503 });
  samples.delivery.push({ ms: 12, status: 307 });

  const summary = summarizeSamples(samples);

  assert.deepEqual(summary.uploadActive, {
    count: 2,
    p50Ms: 20,
    p95Ms: 40,
    maxMs: 40,
    requestErrors: 0,
  });
  assert.equal(summary.expirationPause.maxMs, 5);
  assert.equal(summary.resume.requestErrors, 1);
  assert.equal(summary.resume.maxMs, 10);
  assert.equal(summary.delivery.requestErrors, 0);
  assert.equal(summary.delivery.maxMs, 12);
});
