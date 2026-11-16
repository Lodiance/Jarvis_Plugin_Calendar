// Runs this plugin the way the Jarvis host does (its own process, a key, a data folder) and calls its
// endpoints. Needs only Node: `npm test` in this folder. `npm run plugin:check <this folder>` in the Jarvis
// repo goes further and checks the cards against the component rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const KEY = 'test-key';
let proc, base, dataDir;

const call = (route, body, key = KEY) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-plugin-key': key, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${manifest.id}-test-`));
  const port = await new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [path.join(here, 'plugin.js')], { env: { PORT: String(port), PLUGIN_KEY: KEY, DATA_DIR: dataDir, SystemRoot: process.env.SystemRoot ?? '' }, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 50; i++) {
    try { if ((await call('/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('plugin did not start');
});

after(() => { proc?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('refuses requests without the key', async () => {
  assert.equal((await call('/manifest', undefined, 'wrong')).status, 401);
});

test('serves its manifest', async () => {
  assert.deepEqual(await (await call('/manifest')).json(), manifest);
});

test('a note added with the tool shows on the card', async () => {
  const empty = await (await call('/cards/main')).json();
  assert.equal(empty.view.children[0].items.length, 0);
  const r = await (await call(`/tools/${manifest.id}.add`, { text: '  買牛奶  ' })).json();
  assert.equal(r.result.added, '買牛奶');
  const card = await (await call('/cards/main')).json();
  assert.equal(card.view.children[0].items[0].text, '買牛奶');
});

test('an empty note is an error the host can show', async () => {
  const r = await call(`/tools/${manifest.id}.add`, { text: ' ' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /空/);
});
