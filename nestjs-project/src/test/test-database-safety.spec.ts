import {
  assertConnectedTestDatabase,
  validateTestDatabaseTarget,
} from './test-database-safety';
import {
  cleanAllTables,
  createTestDataSource,
} from './create-test-data-source';
import type { DataSource } from 'typeorm';

describe('test database safety', () => {
  const validEnv: NodeJS.ProcessEnv = {
    DB_HOST: 'db-test',
    DB_NAME: 'streamtube_phase03_test',
    DB_DATABASE: 'streamtube_phase03_test',
    DB_USERNAME: 'streamtube_phase03_test',
  };

  it.each([
    [{ ...validEnv, DB_HOST: undefined }, 'explicit DB_HOST'],
    [{ ...validEnv, DB_NAME: undefined }, 'explicit DB_HOST'],
    [{ ...validEnv, DB_DATABASE: undefined }, 'explicit DB_HOST'],
    [{ ...validEnv, DB_USERNAME: undefined }, 'explicit DB_HOST'],
    [{ ...validEnv, DB_DATABASE: 'other_test' }, 'DB_NAME to equal'],
    [
      { ...validEnv, DB_NAME: 'streamtube', DB_DATABASE: 'streamtube' },
      'non-test database',
    ],
    [
      { ...validEnv, DB_USERNAME: 'streamtube' },
      'non-test database credential',
    ],
  ])(
    'rejects unsafe configuration before creating a data source',
    (env, message) => {
      expect(() => validateTestDatabaseTarget(env)).toThrow(message);
    },
  );

  it('accepts an explicit isolated target and restricted credential', () => {
    expect(validateTestDatabaseTarget(validEnv)).toEqual({
      database: 'streamtube_phase03_test',
      host: 'db-test',
      username: 'streamtube_phase03_test',
    });
  });

  it('rejects before constructing a test data source', () => {
    const previous = process.env.DB_DATABASE;
    process.env.DB_DATABASE = 'different_test';
    try {
      expect(() => createTestDataSource([])).toThrow('DB_NAME to equal');
    } finally {
      process.env.DB_DATABASE = previous;
    }
  });

  it('does not query or delete when cleanup configuration is unsafe', async () => {
    const previous = process.env.DB_NAME;
    process.env.DB_NAME = 'streamtube';
    const query = jest.fn();
    try {
      await expect(
        cleanAllTables({ query } as unknown as DataSource),
      ).rejects.toThrow('DB_NAME to equal');
      expect(query).not.toHaveBeenCalled();
    } finally {
      process.env.DB_NAME = previous;
    }
  });

  it('rejects a connection whose effective database diverges', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        current_database: 'streamtube',
        current_user: 'streamtube_phase03_test',
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    await expect(
      assertConnectedTestDatabase(
        query,
        'streamtube_phase03_test',
        'streamtube_phase03_test',
      ),
    ).rejects.toThrow('does not match streamtube_phase03_test');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['current_user', { current_user: 'streamtube_phase03_admin' }],
    ['rolsuper', { rolsuper: true }],
    ['rolcreatedb', { rolcreatedb: true }],
    ['rolcreaterole', { rolcreaterole: true }],
    ['rolreplication', { rolreplication: true }],
  ])('rejects an unsafe connected identity: %s', async (_field, override) => {
    const query = jest.fn().mockResolvedValue([
      {
        current_database: 'streamtube_phase03_test',
        current_user: 'streamtube_phase03_test',
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolsuper: false,
        ...override,
      },
    ]);

    await expect(
      assertConnectedTestDatabase(
        query,
        'streamtube_phase03_test',
        'streamtube_phase03_test',
      ),
    ).rejects.toThrow();
  });
});
