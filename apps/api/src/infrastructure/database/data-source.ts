import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { types as pgTypes } from 'pg';

// عمود DATE يُعاد كنص YYYY-MM-DD (لا ككائن Date يتأثر بمنطقة العملية الزمنية)
pgTypes.setTypeParser(1082, (value: string) => value);
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * مصدر البيانات (TypeORM + PostgreSQL).
 *
 * قرار معماري موثّق: نستخدم TypeORM لإدارة الاتصال والمعاملات (Transactions)،
 * بينما تكتب المستودعات SQL صريحًا مُعامَلًا (parameterized). السبب:
 *  - تحكم كامل في القيود والأداء بدون طبقة تعيين تخفي ما يحدث،
 *  - مخطط قاعدة البيانات (ملفات SQL في migrations/) هو مصدر الحقيقة الوحيد،
 *  - لا حاجة لتنزيل محركات خارجية (بعكس Prisma) مما يبسّط النشر في بيئات مقيّدة.
 */
export interface DataSourceInput {
  url: string;
  ssl: boolean;
  maxConnections: number;
  logging?: boolean;
}

export function buildDataSource(input: DataSourceInput): DataSource {
  return new DataSource({
    type: 'postgres',
    url: input.url,
    ssl: input.ssl ? { rejectUnauthorized: false } : false,
    extra: {
      max: input.maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    },
    logging: input.logging ? ['error', 'warn'] : ['error'],
    // لا كيانات: المستودعات تستخدم SQL صريحًا (انظر القرار أعلاه)
    entities: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
  });
}

export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export interface MigrationFile {
  name: string;
  sql: string;
}

/** يقرأ ملفات SQL مرتبة أبجديًا (البادئة الرقمية تضمن الترتيب الصحيح) */
export async function loadMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    out.push({ name: file.replace(/\.sql$/, ''), sql });
  }
  return out;
}
