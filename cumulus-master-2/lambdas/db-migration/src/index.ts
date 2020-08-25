import Knex from 'knex';
import * as path from 'path';

export type Command = 'latest';

export interface HandlerEvent {
  command?: Command,
  env?: NodeJS.ProcessEnv
}

const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env?.[name];

  if (value) return value;

  throw new Error(`The ${name} environment variable must be set`);
};

const getConnectionConfig = (env: NodeJS.ProcessEnv): Knex.PgConnectionConfig => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  // TODO Get this value from secrets manager
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});

export const handler = async (event: HandlerEvent): Promise<void> => {
  const env = event?.env ?? process.env;

  const knex = Knex({
    client: 'pg',
    connection: getConnectionConfig(env),
    debug: env?.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
    migrations: {
      directory: path.join(__dirname, 'migrations'),
    },
  });

  const command = event?.command ?? 'latest';

  try {
    switch (command) {
      case 'latest':
        await knex.migrate.latest();
        break;
      default:
        throw new Error(`Invalid command: ${command}`);
    }
  } finally {
    await knex.destroy();
  }
};
