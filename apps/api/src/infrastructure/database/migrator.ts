import type { DataSource, EntityManager } from 'typeorm';
import { loadMigrationFiles, type MigrationFile } from './data-source';

/**
 * مُنفِّذ الهجرات (Migrations) — ملفات SQL صريحة داخل معاملات، مع جدول تتبّع.
 *
 * الخصائص:
 *  - كل ملف يُنفَّذ في معاملة واحدة: إما ينجح بالكامل أو يعود كل شيء.
 *  - `schema_migrations` يسجّل الاسم والبصمة (SHA-256) لمنع تعديل هجرة مطبَّقة.
 *  - idempotent: يمكن تشغيله عند كل إقلاع بأمان.
 */
export interface MigrationResult {
  applied: MigrationFile[];
  skipped: string[];
  checksumMismatch: string[];
}

async function ensureTable(run: (sql: string, params?: unknown[]) => Promise<unknown>): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name         text PRIMARY KEY,
      checksum     text NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      duration_ms  integer
    )
  `);
}

function sha256(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function runMigrations(dataSource: DataSource, dir?: string): Promise<MigrationResult> {
  if (!dataSource.isInitialized) await dataSource.initialize();

  await ensureTable((sql) => dataSource.query(sql));
  const files = await loadMigrationFiles(dir);
  const rows: { name: string; checksum: string }[] = await dataSource.query(
    'SELECT name, checksum FROM schema_migrations',
  );
  const appliedMap = new Map(rows.map((r) => [r.name, r.checksum]));

  const result: MigrationResult = { applied: [], skipped: [], checksumMismatch: [] };

  for (const file of files) {
    const checksum = sha256(file.sql);
    const existing = appliedMap.get(file.name);

    if (existing) {
      if (existing !== checksum) {
        result.checksumMismatch.push(file.name);
        throw new Error(
          `Migration "${file.name}" was modified after being applied. ` +
            `Create a new migration file instead of editing an applied one.`,
        );
      }
      result.skipped.push(file.name);
      continue;
    }

    const startedAt = Date.now();
    await dataSource.transaction(async (manager: EntityManager) => {
      await manager.query(file.sql);
      await manager.query(
        'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
        [file.name, checksum, Date.now() - startedAt],
      );
    });
    result.applied.push(file);
  }

  return result;
}

export async function migrationStatus(dataSource: DataSource, dir?: string) {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await ensureTable((sql) => dataSource.query(sql));
  const files = await loadMigrationFiles(dir);
  const rows: { name: string; checksum: string; applied_at: string }[] = await dataSource.query(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  const applied = new Map(rows.map((r) => [r.name, r]));
  return files.map((f) => ({
    name: f.name,
    status: applied.has(f.name)
      ? applied.get(f.name)!.checksum === sha256(f.sql)
        ? ('applied' as const)
        : ('modified' as const)
      : ('pending' as const),
    appliedAt: applied.get(f.name)?.applied_at ?? null,
  }));
}

/** يُستخدم في الاختبارات: يعيد بناء قاعدة اختبار نظيفة */
export async function resetSchema(dataSource: DataSource): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query('DROP SCHEMA public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
  await dataSource.query('GRANT ALL ON SCHEMA public TO public');
}
