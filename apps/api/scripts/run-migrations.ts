import 'reflect-metadata';
import { scriptEnv } from './env';
import { buildConfig } from '../src/config/configuration';
import { buildDataSource } from '../src/infrastructure/database/data-source';
import { runMigrations } from '../src/infrastructure/database/migrator';

/**
 * تطبيق الهجرات: `npm run migrate` (أو `npm run migrate -- --database=test`).
 */
async function main(): Promise<void> {
  const useTest = process.argv.includes('--database=test') || process.argv.includes('--test');
  const env = scriptEnv(useTest ? 'test' : 'main');
  const config = buildConfig(env);
  const dataSource = buildDataSource({
    url: config.databaseUrl,
    ssl: config.databaseSsl,
    maxConnections: 3,
    logging: false,
  });

  process.stdout.write(`⏳ تطبيق الهجرات على ${maskUrl(config.databaseUrl)}\n`);
  const startedAt = Date.now();
  const result = await runMigrations(dataSource);

  for (const file of result.applied) {
    process.stdout.write(`  ✅ ${file.name}\n`);
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`  ⏭️  ${result.skipped.length} هجرة مطبَّقة مسبقًا\n`);
  }
  process.stdout.write(
    `✨ انتهى في ${Date.now() - startedAt}ms — المطبَّق الآن: ${result.applied.length}\n`,
  );

  await dataSource.destroy();
}

function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

main().catch((error) => {
  process.stderr.write(`❌ فشل تنفيذ الهجرات: ${error?.message ?? error}\n`);
  process.exit(1);
});
