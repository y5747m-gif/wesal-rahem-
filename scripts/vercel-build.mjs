#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceDir = path.join(root, 'public');
const destinations = [
  path.join(root, 'dist'),
  path.join(root, 'apps', 'api', 'public'),
  path.join(root, 'apps', 'api', 'dist'),
];

const html = await readFile(path.join(sourceDir, 'index.html'), 'utf8');
if (!html.includes('<html lang="ar" dir="rtl">') || !html.includes('وصال')) {
  console.error('public/index.html must be the Arabic RTL home page.');
  process.exit(1);
}
if (!html.includes('hero.jpg')) {
  console.error('public/index.html must reference hero.jpg so the home page is not an empty shell.');
  process.exit(1);
}

await mkdir(sourceDir, { recursive: true });
for (const destination of destinations) {
  await mkdir(destination, { recursive: true });
  await cp(sourceDir, destination, { recursive: true });
}

await writeFile(path.join(root, 'index.html'), html);
await cp(path.join(sourceDir, 'hero.jpg'), path.join(root, 'hero.jpg'));
await cp(path.join(sourceDir, 'favicon.svg'), path.join(root, 'favicon.svg'));

console.log('Vercel output ready: public/index.html (and dist/, apps/api/public/).');
