import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * تحميل `.env` بدون اعتمادية خارجية — القيم الموجودة مسبقًا في البيئة لها الأولوية.
 * يبحث في مجلد التطبيق ثم جذر المستودع.
 */
export function loadEnvFile(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
  ];
  const file = candidates.find((f) => existsSync(f));
  if (!file) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
