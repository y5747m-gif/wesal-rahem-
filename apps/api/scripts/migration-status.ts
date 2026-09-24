import 'reflect-metadata';
import { scriptEnv } from './env';
import { buildConfig } from '../src/config/configuration';
import { buildDataSource } from '../src/infrastructure/database/data-source';
import { migrationStatus } from '../src/infrastructure/database/migrator';

/** حالة الهجرات: `npm run migrate:status` */
async function main(): Promise<void> {
  const env = scriptEnv('main');
  const config = buildConfig(env);
  const dataSource = buildDataSource({
    url: config.databaseUrl,
    ssl: config.databaseSsl,
    maxConnections: 2,
    logging: false,
  });

  const status = await migrationStatus(dataSource);
  for (const row of status) {
    const icon = row.status === 'applied' ? '✅' : row.status === 'pending' ? '⏳' : '⚠️';
    process.stdout.write(`${icon} ${row.name.padEnd(42)} ${row.status}${row.appliedAt ? ` (${row.appliedAt})` : ''}\n`);
  }
  await dataSource.destroy();
}

main().catch((error) => {
  process.stderr.write(`❌ ${error?.message ?? error}\n`);
  process.exit(1);
});
