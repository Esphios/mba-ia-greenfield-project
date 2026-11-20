const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

if (process.argv[1]?.endsWith('dist/main')) {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  let previous = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const utilization = performance.eventLoopUtilization(previous);
    previous = performance.eventLoopUtilization();
    console.log(JSON.stringify({
      metric: 'phase03-eventloop',
      timestamp: new Date().toISOString(),
      p95Ms: delay.percentile(95) / 1e6,
      maxMs: delay.max / 1e6,
      utilization: utilization.utilization,
      rssMiB: process.memoryUsage().rss / 1024 / 1024,
    }));
    delay.reset();
  }, 5000);
  timer.unref();
}
