export interface TestDatabaseTarget {
  database: string;
  host: string;
  username: string;
}

interface ConnectedDatabaseIdentity {
  current_database: string;
  current_user: string;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolsuper: boolean;
}

const TEST_DATABASE_PATTERN = /(?:^|_)test(?:_|$)/i;

export function validateTestDatabaseTarget(
  env: NodeJS.ProcessEnv,
): TestDatabaseTarget {
  const dbName = env.DB_NAME?.trim();
  const dbDatabase = env.DB_DATABASE?.trim();
  const host = env.DB_HOST?.trim();
  const username = env.DB_USERNAME?.trim();

  if (!host || !dbName || !dbDatabase || !username) {
    throw new Error(
      'Test database requires explicit DB_HOST, DB_NAME, DB_DATABASE and DB_USERNAME',
    );
  }
  if (dbName !== dbDatabase) {
    throw new Error('Test database requires DB_NAME to equal DB_DATABASE');
  }
  if (!TEST_DATABASE_PATTERN.test(dbName)) {
    throw new Error(`Refusing non-test database target: ${dbName}`);
  }
  if (!TEST_DATABASE_PATTERN.test(username)) {
    throw new Error(`Refusing non-test database credential: ${username}`);
  }

  return { database: dbName, host, username };
}

export async function assertConnectedTestDatabase(
  query: (
    sql: string,
    parameters?: unknown[],
  ) => Promise<ConnectedDatabaseIdentity[]>,
  expectedDatabase: string,
  expectedUsername: string,
): Promise<void> {
  const rows = await query(
    `SELECT current_database(), current_user,
            rolsuper, rolcreatedb, rolcreaterole, rolreplication
       FROM pg_roles
      WHERE rolname = current_user`,
  );
  const identity = rows[0];
  if (identity?.current_database !== expectedDatabase) {
    throw new Error(
      `Connected database ${identity?.current_database ?? '<unknown>'} does not match ${expectedDatabase}`,
    );
  }
  if (identity.current_user !== expectedUsername) {
    throw new Error(
      `Connected database user ${identity.current_user} does not match ${expectedUsername}`,
    );
  }
  if (
    identity.rolsuper ||
    identity.rolcreatedb ||
    identity.rolcreaterole ||
    identity.rolreplication
  ) {
    throw new Error(
      `Refusing privileged test database role: ${identity.current_user}`,
    );
  }
}
