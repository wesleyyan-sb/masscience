import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const distWeb = path.join(root, 'dist', 'web');
const src = [
  'index.html',
  'style.css',
  'app.js',
  'js',
  'assets',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(from, to) {
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function main() {
  ensureDir(distWeb);
  for (const item of src) {
    const from = path.join(root, item);
    const to = path.join(distWeb, item);
    if (fs.existsSync(from)) {
      if (fs.statSync(from).isDirectory()) copyDir(from, to);
      else fs.copyFileSync(from, to);
    }
  }
  console.log(`Web build generated at ${distWeb}`);
}

main();
