const STAGES = [
  'baseline',
  'uploadActive',
  'expirationPause',
  'resume',
  'processing',
  'delivery',
];

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

function summarizeSamples(samples) {
  return Object.fromEntries(
    STAGES.map((stage) => {
      const entries = samples[stage] ?? [];
      const successful = entries.filter((item) => item.status >= 200 && item.status < 400);
      const values = successful.map((item) => item.ms);
      return [
        stage,
        {
          count: values.length,
          p50Ms: percentile(values, 0.5),
          p95Ms: percentile(values, 0.95),
          maxMs: values.length ? Math.max(...values) : null,
          requestErrors: entries.length - successful.length,
        },
      ];
    }),
  );
}

module.exports = { STAGES, summarizeSamples };
