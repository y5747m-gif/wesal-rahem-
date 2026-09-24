import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * تحميل متغيرات البيئة للسكربتات (بدون اعتماديات إضافية).
 * الترتيب: متغيرات النظام ← ملف .env في مجلد التطبيق ← .tmp/db.json (إن وُجد).
 */
export function loadEnvFile(file = path.join(__dirname, '..', '.env')): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** يقرأ بيانات قاعدة البيانات المحلية التي تولّدها tools/db (إن كانت تعمل) */
export function readLocalDbInfo(): { connectionString?: string; testConnectionString?: string } {
  const file = path.join(__dirname, '..', '..', '..', '.tmp', 'db.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function scriptEnv(database: 'main' | 'test' = 'main'): NodeJS.ProcessEnv {
  const fromFile = loadEnvFile();
  const dbInfo = readLocalDbInfo();
  const merged: NodeJS.ProcessEnv = { ...process.env, ...fromFile };

  if (database === 'test') {
    const testUrl =
      process.env.DATABASE_URL_TEST ??
      fromFile.DATABASE_URL_TEST ??
      dbInfo.testConnectionString ??
      (fromFile.DATABASE_URL ? `${fromFile.DATABASE_URL}_test` : undefined);
    if (!testUrl) {
      throw new Error('DATABASE_URL_TEST is not set and no local test database was found (npm run db:up)');
    }
    merged.DATABASE_URL = testUrl;
    merged.NODE_ENV = 'test';
  } else if (!merged.DATABASE_URL && dbInfo.connectionString) {
    merged.DATABASE_URL = dbInfo.connectionString;
  }

  if (!merged.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env or run `npm run db:up`.');
  }
  return merged;
}
