import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const indexPath = path.join(process.cwd(), 'public', 'index.html');

try {
  await access(indexPath, constants.R_OK);
} catch {
  console.error('Missing apps/api/public/index.html — the Vercel root would 404.');
  process.exit(1);
}

console.log('Static home is ready at public/index.html');
