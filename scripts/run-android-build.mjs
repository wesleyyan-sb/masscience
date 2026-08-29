import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');
const isWindows = process.platform === 'win32';

const gradlew = isWindows ? 'gradlew.bat' : './gradlew';
const res = spawnSync(gradlew, ['assembleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
  env: process.env,
});

if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}

process.exit(res.status ?? 1);
