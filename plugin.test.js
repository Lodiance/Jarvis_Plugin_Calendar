// Two layers: the real process the way the Jarvis host runs it (key, manifest, no secrets yet), and the card and
// tools against a fake Radicale through app(), which takes the secrets kit 0.2 can't deliver yet.
// `npm run plugin:check <this folder>` in the Jarvis repo goes further and checks the views against the component rules.
import { test, before, beforeEach, after } from 'node:test';
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
let proc, base, dataDir, appDir, radicale, secrets, closeFake;

const call = (route, body, key = KEY) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-plugin-key': key, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// --- fake Radicale: one calendar, resources by href with ETags; honours If-Match / If-None-Match ---
const ics = lines => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const SEED = {
  '/u/cal/a.ics': ics(['UID:standup', 'DTSTART;TZID=Asia/Taipei:20261116T100000', 'DTEND;TZID=Asia/Taipei:20261116T110000',
    'SUMMARY:站會', 'LOCATION:3F', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC', 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM']),
  '/u/cal/b.ics': ics(['UID:weekly', 'RECURRENCE-ID:20261118T020000Z', 'DTSTART:20261118T020000Z', 'DURATION:PT1H', 'SUMMARY:週會']),
  '/u/cal/c.ics': ics(['UID:xmas', 'DTSTART;VALUE=DATE:20261225', 'SUMMARY:聖誕節']),
};
let store, etagN, sabotage; // sabotage: the next PUT/DELETE finds the event changed elsewhere first
const reset = () => { store = new Map(Object.entries(SEED).map(([h, d]) => [h, { ics: d, etag: `"e${etagN = (etagN ?? 0) + 1}"` }])); sabotage = false; };
const multistatus = body => `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</multistatus>`;
const PROPFIND = multistatus(`<response><href>/u/cal/</href><propstat><prop><displayname>個人</displayname>
  <resourcetype><collection/><C:calendar/></resourcetype><C:calendar-timezone>BEGIN:VTIMEZONE&#13;
TZID:Asia/Taipei&#13;
END:VTIMEZONE</C:calendar-timezone></prop></propstat></response>`);
const report = body => {
  const uid = body.match(/<C:text-match[^>]*>([^<]*)</)?.[1];
  const hits = [...store].filter(([, r]) => !uid || r.ics.includes('UID:' + uid));
  return multistatus(hits.map(([h, r]) => `<response><href>${h}</href><propstat><prop><getetag>${r.etag}</getetag>` +
    `<C:calendar-data><![CDATA[${r.ics}]]></C:calendar-data></prop></propstat></response>`).join(''));
};
function radicaleHandler(req, res, body) {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('u:pw').toString('base64')) return res.writeHead(401).end();
  const cur = store.get(req.url);
  if ((req.method === 'PUT' || req.method === 'DELETE') && sabotage && cur) {
    sabotage = false;
    cur.ics = cur.ics.replace(/SUMMARY:[^\r\n]*/, 'SUMMARY:別處改的'); cur.etag = `"e${++etagN}"`;
  }
  if (req.method === 'PROPFIND') return res.writeHead(207).end(PROPFIND);
  if (req.method === 'REPORT') return res.writeHead(207).end(report(body));
  const im = req.headers['if-match'], inm = req.headers['if-none-match'];
  if ((inm === '*' && cur) || (im && im !== cur?.etag)) return res.writeHead(412).end();
  if (req.method === 'PUT') { store.set(req.url, { ics: body, etag: `"e${++etagN}"` }); return res.writeHead(cur ? 204 : 201).end(); }
  if (req.method === 'DELETE') { store.delete(req.url); return res.writeHead(204).end(); }
  res.writeHead(405).end();
}

const now = zonedToUtc('2026-11-16T10:30', 'Asia/Taipei');
const plugin = () => app(() => secrets, () => now, appDir);
const good = () => ({ caldav_url: radicale + '/u/', caldav_user: 'u', caldav_password: 'pw' });
const byUid = uid => [...store.values()].find(r => r.ics.includes('UID:' + uid))?.ics;

before(async () => {
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }).on('end', () => radicaleHandler(req, res, b)); });
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
beforeEach(() => {
  reset();
  secrets = good();
  if (appDir) fs.rmSync(appDir, { recursive: true, force: true });
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), `${manifest.id}-app-`));
});
after(() => { closeFake?.(); proc?.kill(); for (const d of [dataDir, appDir]) if (d) fs.rmSync(d, { recursive: true, force: true }); });

// --- the process ---

test('process: refuses requests without the key, serves its manifest', async () => {
  assert.equal((await call('/manifest', undefined, 'wrong')).status, 401);
  assert.deepEqual(await (await call('/manifest')).json(), manifest);
});

test('process: without secrets the card asks for setup and tools fail with the same hint', async () => {
  const card = await (await call('/cards/upcoming')).json();
  assert.deepEqual([card.view.type, card.view.tone], ['callout', 'warn']);
  assert.match(card.view.text, /#\/dev\/plugins/);
  for (const t of ['calendar.list', 'calendar.create', 'calendar.delete']) {
    const r = await call(`/tools/${t}`, { uid: 'x', title: 'x', start: '2026-11-16T10:00' });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /尚未設定 Radicale/);
  }
});

// --- reading (v0.1) ---

test('card: next 3 days from Radicale, in the calendar time zone', async () => {
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
  const { tools } = plugin();
  const all = (await tools['calendar.list']({ from: '2026-11-16', to: '2026-12-31' })).result;
  assert.deepEqual(all.map(e => [e.uid, e.start, e.end, e.allday, e.recurring]), [
    ['standup', '2026-11-16T10:00', '2026-11-16T11:00', false, false],
    ['weekly', '2026-11-18T10:00', '2026-11-18T11:00', false, true],
    ['xmas', '2026-12-25', '2026-12-25', true, false], // all-day end is the last day, inclusive
  ]);
  assert.equal(all[0].calendar, '個人');
  assert.deepEqual((await tools['calendar.list']({})).result.map(e => e.uid), ['standup']); // today only
  assert.deepEqual((await tools['calendar.list']({ from: '2026-11-16T10:45' })).result.map(e => e.uid), ['standup']);
  await assert.rejects(tools['calendar.list']({ from: '2026-11-01', to: '2027-01-15' }), /62/);
  await assert.rejects(tools['calendar.list']({ from: '11/16' }), /from 格式/);
  await assert.rejects(tools['calendar.list']({ from: '2026-11-20', to: '2026-11-10' }), /晚於/);
});

test('calendar.month and calendar.event return views', async () => {
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

// --- writing (v0.2) ---

test('create: timed event with default 1h end, written as UTC, then that day\'s month view', async () => {
  const r = await plugin().tools['calendar.create']({ title: '看牙醫', start: '2026-11-20T15:00', location: '中山路', notes: 'a, b\nc' });
  assert.equal(r.notice, '已新增「看牙醫」');
  assert.equal(r.view.children[1].children[0].selected, '2026-11-20');
  const stored = store.get(`/u/cal/${r.result.uid}.ics`).ics;
  assert.match(stored, /DTSTART:20261120T070000Z\r\nDTEND:20261120T080000Z/);
  assert.match(stored, /DESCRIPTION:a\\, b\\nc/);
  const listed = (await plugin().tools['calendar.list']({ from: '2026-11-20' })).result;
  assert.deepEqual(listed.map(e => [e.title, e.start, e.end, e.location]), [['看牙醫', '2026-11-20T15:00', '2026-11-20T16:00', '中山路']]);
});

test('create: all-day from a date-only start, multi-day end inclusive, form datetime trimmed', async () => {
  const { tools } = plugin();
  const a = await tools['calendar.create']({ title: '旅行', start: '2026-11-20', end: '2026-11-22' });
  assert.match(store.get(`/u/cal/${a.result.uid}.ics`).ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261123/);
  const b = await tools['calendar.create']({ title: '假日', allday: true, start: '2026-11-21T09:00' }); // what the form sends
  assert.match(store.get(`/u/cal/${b.result.uid}.ics`).ics, /DTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261122/);
  await assert.rejects(tools['calendar.create']({ title: 'x', start: '2026-11-20T10:00', end: '2026-11-20T09:00' }), /之後/);
  await assert.rejects(tools['calendar.create']({ title: ' ', start: '2026-11-20T10:00' }), /title 必填/);
  await assert.rejects(tools['calendar.create']({ title: 'x', start: '2026-11-20T10:00', calendar: '公司' }), /沒有叫「公司」/);
});

test('update: changes only what was sent and keeps alarms and unknown properties', async () => {
  const r = await plugin().tools['calendar.update']({ uid: 'standup', title: '站會（改）', location: '' });
  assert.equal(r.notice, '已更新「站會（改）」');
  const stored = byUid('standup');
  assert.match(stored, /SUMMARY:站會（改）/);
  assert.doesNotMatch(stored, /LOCATION/);
  assert.match(stored, /DTSTART;TZID=Asia\/Taipei:20261116T100000/); // times untouched
  assert.match(stored, /X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC/);
  assert.match(stored, /BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM/);
  assert.match(stored, /SEQUENCE:1/);
});

test('update: moving only the end keeps the start; moving the start resets the end to +1h', async () => {
  const { tools } = plugin();
  await tools['calendar.update']({ uid: 'standup', end: '2026-11-16T12:00' });
  assert.match(byUid('standup'), /DTSTART:20261116T020000Z\r\nDTEND:20261116T040000Z/);
  await tools['calendar.update']({ uid: 'standup', start: '2026-11-17T09:00' });
  assert.match(byUid('standup'), /DTSTART:20261117T010000Z\r\nDTEND:20261117T020000Z/);
  await assert.rejects(tools['calendar.update']({ uid: 'standup' }), /沒有要改的欄位/);
});

test('recurring events can be read but not edited, deleted or opened in the form', async () => {
  const { tools } = plugin();
  for (const [t, input] of [['calendar.update', { uid: 'weekly', title: 'x' }], ['calendar.delete', { uid: 'weekly' }], ['calendar.form', { uid: 'weekly' }]]) {
    await assert.rejects(tools[t](input), /重複行程/);
  }
  assert.match(byUid('weekly'), /SUMMARY:週會/);
});

test('412: changed elsewhere between read and write → no retry, show the latest version', async () => {
  const { tools } = plugin();
  sabotage = true;
  const r = await tools['calendar.update']({ uid: 'standup', title: '我改的' });
  assert.deepEqual([r.notice, r.result.conflict], ['行程在別處被改過，已重新載入', true]);
  assert.equal(r.view.children[0].text, '別處改的');
  assert.match(byUid('standup'), /SUMMARY:別處改的/);
  sabotage = true;
  const d = await tools['calendar.delete']({ uid: 'standup' });
  assert.equal(d.notice, '行程在別處被改過，已重新載入');
  assert.ok(byUid('standup')); // not deleted
});

test('delete: removes the event and returns that day', async () => {
  const r = await plugin().tools['calendar.delete']({ uid: 'xmas' });
  assert.equal(r.notice, '已刪除「聖誕節」');
  assert.equal(r.view.children[1].children[0].selected, '2026-12-25');
  assert.equal(byUid('xmas'), undefined);
  await assert.rejects(plugin().tools['calendar.delete']({ uid: 'xmas' }), /找不到/);
});

test('form: new on a date, edit prefilled with all-day end inclusive', async () => {
  const { tools } = plugin();
  const n = (await tools['calendar.form']({ date: '2026-11-20' })).view;
  assert.equal(n.submit.tool, 'calendar.create');
  assert.equal(n.children.find(f => f.name === 'start').value, '2026-11-20T09:00');
  const trip = await tools['calendar.create']({ title: '旅行', start: '2026-11-20', end: '2026-11-22' });
  const e = (await tools['calendar.form']({ uid: trip.result.uid })).view;
  assert.deepEqual(e.submit.input, { uid: trip.result.uid });
  assert.deepEqual(['title', 'allday', 'start', 'end'].map(n => { const f = e.children.find(c => c.name === n); return f.value ?? f.checked; }),
    ['旅行', true, '2026-11-20T00:00', '2026-11-22T00:00']);
  assert.equal(e.children.some(c => c.name === 'calendar'), false);
});

test('settings: form, validation, saved values used by the card; a broken file means defaults', async () => {
  const { tools, cards } = plugin();
  const form = (await tools['calendar.settings']({})).view;
  assert.deepEqual(form.children.map(c => [c.name, c.value]), [['timezone', ''], ['days', 3], ['calendar', '個人']]);
  await assert.rejects(tools['calendar.settings']({ timezone: 'Mars/Base' }), /不認得的時區/);
  await assert.rejects(tools['calendar.settings']({ days: 20 }), /1–14/);
  assert.equal((await tools['calendar.settings']({ timezone: 'Europe/London', days: 1 })).notice, '已儲存設定');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(appDir, 'settings.json'), 'utf8')), { timezone: 'Europe/London', days: 1 });
  // 10:30 Taipei is 02:30 in London: still the 16th, but stand-up (02:00–03:00 UTC) shows in London time, one day only
  const titles = (await cards.upcoming()).view.children.filter(c => c.title).map(c => c.text);
  assert.deepEqual(titles, ['今天 · 11/16（一）']);
  fs.writeFileSync(path.join(appDir, 'settings.json'), '{broken');
  assert.equal((await cards.upcoming()).view.children.filter(c => c.title).length, 2); // days back to 3, tz back to Taipei
});
