import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_PATHS = [
  'video-upload.service.ts',
  'upload-reconciler.service.ts',
  'processing/video-processor.service.ts',
  'processing/processing-recovery.service.ts',
  'processing/outbox-dispatcher.service.ts',
];

describe('video persistence boundaries', () => {
  it.each(SERVICE_PATHS)(
    '%s delegates persistence and transactions to repositories',
    (relativePath) => {
      const source = readFileSync(join(__dirname, relativePath), 'utf8');

      expect(source).not.toMatch(
        /InjectDataSource|\bDataSource\b|\bEntityManager\b/,
      );
      expect(source).not.toMatch(/\.query\s*\(|\.transaction\s*\(/);
      expect(source).not.toMatch(/`\s*(?:SELECT|UPDATE|INSERT|DELETE|WITH)\b/i);
    },
  );
});
