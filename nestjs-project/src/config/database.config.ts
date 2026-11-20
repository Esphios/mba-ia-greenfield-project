import { registerAs } from '@nestjs/config';
import { validateTestDatabaseTarget } from '../test/test-database-safety';

export default registerAs('database', () => {
  const testTarget =
    process.env.NODE_ENV === 'test'
      ? validateTestDatabaseTarget(process.env)
      : undefined;
  return {
    host: testTarget?.host ?? process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: testTarget?.username ?? process.env.DB_USERNAME ?? 'streamtube',
    password: process.env.DB_PASSWORD || 'streamtube',
    name: testTarget?.database ?? process.env.DB_NAME ?? 'streamtube',
  };
});
