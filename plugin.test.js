// Two layers: the real process the way the Jarvis host runs it (key, manifest, no secrets yet), and the card and
// tools against a fake Radicale through app(), which takes the secrets kit 0.2 can't deliver yet.
// `npm run plugin:check <this folder>` in the Jarvis repo goes further and checks the views against the component rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { app } from './plugin.js';
import { zonedToUtc } from './caldav.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const KEY = 'test-key';
let proc, base, dataDir, radicale, secrets, closeFake;

const call = (route, body, key = KEY) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-plugin-key': key, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const ics = lines => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const EVENTS = [
  ics(['UID:standup', 'DTSTART;TZID=Asia/Taipei:20261116T100000', 'DTEND;TZID=Asia/Taipei:20261116T110000', 'SUMMARY:站會', 'LOCATION:3F']),
  ics(['UID:weekly', 'RECURRENCE-ID:20261118T020000Z', 'DTSTART:20261118T020000Z', 'DURATION:PT1H', 'SUMMARY:週會']),
  ics(['UID:xmas', 'DTSTART;VALUE=DATE:20261225', 'SUMMARY:聖誕節']),
];
const multistatus = body => `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</multistatus>`;
const PROPFIND = multistatus(`<response><href>/u/cal/</href><propstat><prop><displayname>個人</displayname>
  <resourcetype><collection/><C:calendar/></resourcetype><C:calendar-timezone>BEGIN:VTIMEZONE&#13;
TZID:Asia/Taipei&#13;
END:VTIMEZONE</C:calendar-timezone></prop></propstat></response>`);
const REPORT = multistatus(EVENTS.map((e, i) => `<response><href>/u/cal/${i}.ics</href><propstat><prop><C:calendar-data><![CDATA[${e}]]></C:calendar-data></prop></propstat></response>`).join(''));

const now = zonedToUtc('2026-11-16T10:30', 'Asia/Taipei');
const plugin = () => app(() => secrets, () => now);
const good = () => ({ caldav_url: radicale + '/u/', caldav_user: 'u', caldav_password: 'pw' });

before(async () => {
  const fake = http.createServer((req, res) => {
    req.resume().on('end', () => {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('u:pw').toString('base64')) return res.writeHead(401).end();
      res.writeHead(207, { 'content-type': 'application/xml' }).end(req.method === 'PROPFIND' ? PROPFIND : REPORT);
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  radicale = `http://127.0.0.1:${fake.address().port}`;
  closeFake = () => fake.close();

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

after(() => { closeFake?.(); proc?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('process: refuses requests without the key, serves its manifest', async () => {
  assert.equal((await call('/manifest', undefined, 'wrong')).status, 401);
  assert.deepEqual(await (await call('/manifest')).json(), manifest);
});

test('process: without secrets the card asks for setup and tools fail with the same hint', async () => {
  const card = await (await call('/cards/upcoming')).json();
  assert.deepEqual([card.view.type, card.view.tone], ['callout', 'warn']);
  assert.match(card.view.text, /#\/dev\/plugins/);
  const r = await call('/tools/calendar.list', {});
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /尚未設定 Radicale/);
});

test('card: next 3 days from Radicale, in the calendar time zone', async () => {
  secrets = good();
  const { view } = await plugin().cards.upcoming();
  const agendas = view.children.filter(c => c.type === 'agenda');
  assert.deepEqual(agendas.map(a => a.items.map(i => [i.time, i.text])), [
    [['10:00–11:00', '站會 · 進行中']],
    [['10:00–11:00', '週會']],
  ]);
});

test('card: wrong password shows an error callout, missing password counts as not set up', async () => {
  secrets = { ...good(), caldav_password: 'nope' };
  assert.deepEqual((await plugin().cards.upcoming()).view.tone, 'error');
  secrets = { ...good(), caldav_password: '' };
  assert.deepEqual((await plugin().cards.upcoming()).view.tone, 'warn');
});

test('calendar.list: local times, defaults, validation', async () => {
  secrets = good();
  const { tools } = plugin();
  const all = (await tools['calendar.list']({ from: '2026-11-16', to: '2026-12-31' })).result;
  assert.deepEqual(all.map(e => [e.uid, e.start, e.end, e.allday, e.recurring]), [
    ['standup', '2026-11-16T10:00', '2026-11-16T11:00', false, false],
    ['weekly', '2026-11-18T10:00', '2026-11-18T11:00', false, true],
    ['xmas', '2026-12-25', '2026-12-26', true, false],
  ]);
  assert.equal(all[0].calendar, '個人');
  assert.deepEqual((await tools['calendar.list']({})).result.map(e => e.uid), ['standup']); // today only
  assert.deepEqual((await tools['calendar.list']({ from: '2026-11-16T10:45' })).result.map(e => e.uid), ['standup']);
  await assert.rejects(tools['calendar.list']({ from: '2026-11-01', to: '2027-01-15' }), /62/);
  await assert.rejects(tools['calendar.list']({ from: '11/16' }), /from 格式/);
  await assert.rejects(tools['calendar.list']({ from: '2026-11-20', to: '2026-11-10' }), /晚於/);
});

test('calendar.month and calendar.event return views', async () => {
  secrets = good();
  const { tools } = plugin();
  const m = await tools['calendar.month']({ month: '2026-12' });
  assert.deepEqual(m.result, { month: '2026-12', date: '2026-12-01', events: 1 });
  assert.equal(m.view.children[1].children[0].days.find(d => d.date === '2026-12-25').items[0].text, '聖誕節');

  const e = await tools['calendar.event']({ uid: 'standup', start: '2026-11-16T10:00' });
  assert.equal(e.result.title, '站會');
  assert.deepEqual(e.view.children[1].items.map(i => i.value), ['11/16（一） 10:00–11:00', '3F', '個人', '進行中']);
  const w = await tools['calendar.event']({ uid: 'weekly', start: '2026-11-18T10:00' });
  assert.equal(w.view.children[1].type, 'callout'); // recurring: edit on iPhone
  await assert.rejects(tools['calendar.event']({ uid: 'standup', start: '2026-11-17T10:00' }), /找不到/);
  await assert.rejects(tools['calendar.event']({ uid: 'standup' }), /start 必填/);
});
