import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingView, monthView, eventView } from './views.js';
import { zonedToUtc } from './caldav.js';

const tz = 'Asia/Taipei';
const at = s => zonedToUtc(s, tz);
const ev = (uid, s, e, extra = {}) => ({ uid, title: uid, start: at(s), end: at(e), allday: false, status: '', recurring: false, ...extra });
const now = at('2026-11-16T10:30'); // Monday
const walk = (v, f) => { f(v); for (const c of v.children ?? []) walk(c, f); };
const find = (v, pred) => { const out = []; walk(v, n => pred(n) && out.push(n)); return out; };

test('upcoming groups by local day, labels today/tomorrow, marks ongoing', () => {
  const v = upcomingView([
    ev('standup', '2026-11-16T10:00', '2026-11-16T11:00'),
    ev('holiday', '2026-11-17', '2026-11-18', { allday: true }),
    ev('late', '2026-11-17T23:00', '2026-11-18T01:00'),
  ], { now, tz });
  assert.deepEqual(find(v, n => n.title).map(n => n.text), ['今天 · 11/16（一）', '明天 · 11/17（二）', '11/18（三）']);
  const [d16, d17, d18] = find(v, n => n.type === 'agenda').map(a => a.items);
  assert.deepEqual(d16[0], { time: '10:00–11:00', text: 'standup · 進行中', tone: 'accent',
    action: { tool: 'calendar.event', input: { uid: 'standup', start: '2026-11-16T10:00' } } });
  assert.deepEqual(d17.map(i => [i.time, i.text, i.allday]), [['全天', 'holiday', true], ['23:00–11/18 01:00', 'late', undefined]]);
  assert.deepEqual(d18.map(i => i.time), ['–01:00']);
  assert.deepEqual(v.children[0].children[0].action, { tool: 'calendar.month', input: { month: '2026-11' } });
});

test('upcoming caps at 8 items and says how many are left; empty says so', () => {
  const many = Array.from({ length: 11 }, (_, i) => ev(`e${i}`, `2026-11-16T${12 + i}:00`, `2026-11-16T${12 + i}:30`));
  const v = upcomingView(many, { now, tz });
  assert.equal(find(v, n => n.type === 'agenda')[0].items.length, 8);
  assert.equal(v.children.at(-1).text, '還有 3 個行程，打開月曆查看');
  assert.equal(upcomingView([], { now, tz, days: 3 }).children.at(-1).text, '接下來 3 天沒有行程');
});

test('month: navigation, per-day cells with strongest live tone, selected day agenda', () => {
  const v = monthView([
    ev('a', '2026-11-20T09:00', '2026-11-20T10:00'),
    ev('b', '2026-11-20T09:30', '2026-11-20T10:30'),
    ev('gone', '2026-11-21T09:00', '2026-11-21T10:00', { status: 'CANCELLED' }),
  ], { now, tz, month: '2026-11', date: '2026-11-20' });
  const [nav, body] = v.children;
  assert.deepEqual(nav.children.map(c => c.action?.input ?? c.text), [
    { month: '2026-10' }, '2026 年 11 月', { month: '2026-12' }, { month: '2026-11', date: '2026-11-16' },
    { date: '2026-11-20' }, {}]); // ＋ 新增 on the selected day, 設定
  const cal = body.children[0];
  assert.equal(cal.days.length, 30);
  const d20 = cal.days.find(d => d.date === '2026-11-20'), d21 = cal.days.find(d => d.date === '2026-11-21');
  assert.deepEqual([d20.text, d20.tone, d20.items.map(i => i.tone)], ['2 個', 'error', ['error', 'error']]);
  assert.deepEqual([d21.tone, d21.items[0].strike], [undefined, true]); // cancelled doesn't colour the cell
  assert.deepEqual(d20.action.input, { month: '2026-11', date: '2026-11-20' });
  assert.equal(body.children[1].children[0].text, '11 月 20 日（五）');
  assert.equal(body.children[1].children[1].items.length, 2);
});

test('month defaults: today when in month, else the 1st; December wraps the year', () => {
  assert.equal(monthView([], { now, tz }).children[1].children[0].selected, '2026-11-16');
  const dec = monthView([], { now, tz, month: '2026-12' });
  assert.equal(dec.children[1].children[0].selected, '2026-12-01');
  assert.deepEqual(dec.children[0].children[2].action.input, { month: '2027-01' });
  assert.equal(dec.children[1].children[1].children[1].text, '沒有行程');
});

test('event details: fields, recurring callout, back to month', () => {
  const e = ev('trip', '2026-11-20', '2026-11-23', { allday: true, recurring: true, location: '台南', calendar: 'Home', description: 'a\nb' });
  const v = eventView(e, { now, tz });
  assert.equal(v.children[1].type, 'callout');
  assert.deepEqual(v.children[2].items, [
    { label: '時間', value: '11/20（五）–11/22（日） 全天' }, { label: '地點', value: '台南' },
    { label: '行事曆', value: 'Home' }, { label: '狀態', value: '一般' }]);
  assert.deepEqual(v.children[3], { type: 'text', text: 'a\nb', pre: true });
  assert.deepEqual(v.children.at(-1).children.map(b => b.label), ['回到月曆']); // recurring: no edit/delete
  assert.deepEqual(v.children.at(-1).children[0].action.input, { date: '2026-11-20' });
  const one = eventView(ev('dentist', '2026-11-20T15:00', '2026-11-20T16:00'), { now, tz }).children.at(-1).children;
  assert.deepEqual(one.map(b => [b.label, b.action.tool, b.style, b.confirm]), [
    ['編輯', 'calendar.form', undefined, undefined],
    ['刪除', 'calendar.delete', 'danger', '刪除「dentist」？'],
    ['回到月曆', 'calendar.month', undefined, undefined],
  ]);
  const clash = eventView(ev('x', '2026-11-16T09:00', '2026-11-16T10:00'), { now, tz, all: [ev('x', '2026-11-16T09:00', '2026-11-16T10:00'), ev('y', '2026-11-16T09:30', '2026-11-16T11:00')] });
  assert.equal(clash.children[1].items.at(-1).value, '時間衝突');
  assert.equal(clash.children[1].items[0].value, '11/16（一） 09:00–10:00');
});
