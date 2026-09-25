#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = ['public/index.html', 'api/health.ts', 'api/index.ts', 'vercel.json'];

async function assertFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  await access(absolutePath, constants.R_OK);
  return absolutePath;
}

for (const file of requiredFiles) {
  try {
    await assertFile(file);
  } catch (error) {
    console.error(`Missing required Vercel file: ${file}`);
    process.exit(1);
  }
}

const html = await readFile(path.join(root, 'public/index.html'), 'utf8');
if (!html.includes('<html lang="ar" dir="rtl">')) {
  console.error('public/index.html must remain Arabic RTL.');
  process.exit(1);
}

console.log('Vercel build check passed: static landing page and health functions are ready.');
