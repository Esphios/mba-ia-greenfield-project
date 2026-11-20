import {
  DataSource,
  type DataSourceOptions,
  type MigrationInterface,
} from 'typeorm';
import {
  assertConnectedTestDatabase,
  validateTestDatabaseTarget,
} from './test-database-safety';

interface TestDataSourceOptions {
  migrations?: (new () => MigrationInterface)[];
}

class TestDataSource extends DataSource {
  constructor(
    options: DataSourceOptions,
    private readonly expectedDatabase: string,
    private readonly expectedUsername: string,
  ) {
    super(options);
  }

  override async initialize(): Promise<this> {
    await super.initialize();
    try {
      await assertConnectedTestDatabase(
        this.query.bind(this),
        this.expectedDatabase,
        this.expectedUsername,
      );
      return this;
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }
}

export function createTestDataSource(
  entities: NonNullable<DataSourceOptions['entities']>,
  options: TestDataSourceOptions = {},
): DataSource {
  const { database, host, username } = validateTestDatabaseTarget(process.env);
  const { migrations } = options;
  return new TestDataSource(
    {
      type: 'postgres',
      host,
      port: Number(process.env.DB_PORT ?? 5432),
      username,
      password: process.env.DB_PASSWORD,
      database,
      entities,
      synchronize: false,
      ...(migrations !== undefined && { migrations, migrationsRun: false }),
    },
    database,
    username,
  );
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  const { database, username } = validateTestDatabaseTarget(process.env);
  await assertConnectedTestDatabase(
    dataSource.query.bind(dataSource),
    database,
    username,
  );
  const tables = [
    'video_processing_outbox',
    'video_upload_sessions',
    'videos',
    'refresh_tokens',
    'verification_tokens',
    'channels',
    'users',
  ];
  for (const table of tables) {
    const [{ exists }] = await dataSource.query<{ exists: boolean }[]>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`public.${table}`],
    );
    if (exists) {
      await dataSource.query(`DELETE FROM "${table}"`);
    }
  }
}
