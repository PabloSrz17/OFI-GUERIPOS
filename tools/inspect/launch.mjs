// Abre Chromium visible con un perfil local y puerto de depuración (solo localhost).
// El usuario inicia sesión manualmente; los demás scripts se conectan vía CDP.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const profile = process.env.PULPOS_PROFILE || path.join(os.tmpdir(), 'pulpos-inspect-profile');
const url = process.argv[2] || 'https://app.pulpos.com';
import fs from 'node:fs';
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(p => fs.existsSync(p));
const exe = process.env.BROWSER_EXE || edge || chromium.executablePath();
const child = spawn(exe, [
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=9222',
  '--remote-debugging-address=127.0.0.1',
  '--window-size=1440,900',
  '--no-first-run',
  url,
], { detached: true, stdio: 'ignore' });
child.unref();
console.log('Chromium abierto. Perfil:', profile);
