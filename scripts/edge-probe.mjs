import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = join(root, 'artifacts', 'edge-probe-profile');
const port = 9333;
if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const child = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    `--user-data-dir=${profile}`,
    `--load-extension=${join(root, 'dist')}`,
    `--disable-extensions-except=${join(root, 'dist')}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function pollVersion() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // not ready
    }
    await sleep(250);
  }
  throw new Error('Edge debugging endpoint did not start');
}

try {
  console.log('version', await pollVersion());
  await sleep(3000);
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  console.log('targets', JSON.stringify(list, null, 2));
  const prefsPath = join(profile, 'Default', 'Preferences');
  if (existsSync(prefsPath)) {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
    console.log('extensions', Object.keys(prefs?.extensions?.settings ?? {}));
    for (const [id, value] of Object.entries(prefs?.extensions?.settings ?? {})) {
      console.log(id, value?.path, value?.state, value?.manifest?.name);
    }
  } else {
    console.log('no Preferences at', prefsPath);
  }
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}