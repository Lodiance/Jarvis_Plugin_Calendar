// Component trees for the card (§6), month dialog (§7) and event details (§8). Pure functions: events in, view out.
// Written for host spec 0.2. 0.3-only props (`bars`, `allday`, `strike`, calendar `items`/`selected`) ride along;
// a 0.2 host drops unknown props and still draws the rest.
// ponytail: no `adaptive` wrapper, `dialog: "wide"` or `grid` ratios yet; their shape isn't in plugin-spec.md.
// Add them when 0.3 lands there.
import { classify, localTime, nextDay } from './caldav.js';

const WD = '日一二三四五六';
const wd = ymd => WD[new Date(ymd + 'T00:00Z').getUTCDay()];
const md = ymd => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`;
const mdw = ymd => `${md(ymd)}（${wd(ymd)}）`;
const STATE_LABEL = { cancelled: '已取消', conflict: '時間衝突', tentative: '未確認', ongoing: '進行中', ended: '已結束', normal: '一般' };

// Local 'YYYY-MM-DD' days an event touches (end exclusive); a zero-length event sits on its start day.
function daysOf(ev, tz) {
  const first = localTime(ev.start, tz).slice(0, 10);
  const last = localTime(new Date(Math.max(+ev.start, +ev.end - 1)), tz).slice(0, 10);
  const out = [first];
  while (out.at(-1) < last) out.push(nextDay(out.at(-1)));
  return out;
}

// Sorted, classified events per local day, limited to `keys`.
function byDay(events, keys, tz, now) {
  const map = new Map(keys.map(k => [k, []]));
  for (const ev of classify(events, now)) for (const d of daysOf(ev, tz)) map.get(d)?.push(ev);
  for (const list of map.values()) list.sort((a, b) => b.allday - a.allday || a.start - b.start);
  return map;
}

const eventInput = (ev, tz) => ({ uid: ev.uid, start: ev.allday ? localTime(ev.start, tz).slice(0, 10) : localTime(ev.start, tz).slice(0, 16) });

// Time column for one day of the agenda: "10:00–11:00", "全天", or partial for events crossing midnight.
function timeOn(ev, day, tz) {
  if (ev.allday) return '全天';
  const s = localTime(ev.start, tz), e = localTime(ev.end, tz);
  const [sd, ed] = [s.slice(0, 10), e.slice(0, 10)];
  if (sd === ed || +ev.end === +ev.start) return `${s.slice(11, 16)}–${e.slice(11, 16)}`;
  if (day === sd) return `${s.slice(11, 16)}–${md(ed)} ${e.slice(11, 16)}`;
  return day === daysOf(ev, tz).at(-1) ? `–${e.slice(11, 16)}` : '整天';
}

const agendaItem = (ev, day, tz) => ({
  time: timeOn(ev, day, tz),
  text: ev.title + (ev.state === 'ongoing' ? ' · 進行中' : ''),
  ...(ev.tone && { tone: ev.tone }),
  ...(ev.allday && { allday: true }),
  ...(ev.strike && { strike: true }),
  action: { tool: 'calendar.event', input: eventInput(ev, tz) },
});

// §6 `upcoming`, narrow layout.
export function upcomingView(events, { now = new Date(), tz, days = 3, max = 8 }) {
  const today = localTime(now, tz).slice(0, 10);
  const keys = [today];
  while (keys.length < days) keys.push(nextDay(keys.at(-1)));
  const groups = byDay(events, keys, tz, now);
  const children = [{ type: 'row', align: 'end', children: [
    { type: 'button', label: '月曆', action: { tool: 'calendar.month', input: { month: today.slice(0, 7) } } },
  ] }];
  let shown = 0, hidden = 0;
  for (const [day, list] of groups) {
    const take = list.slice(0, Math.max(0, max - shown));
    hidden += list.length - take.length;
    if (!take.length) continue;
    shown += take.length;
    const label = day === today ? `今天 · ${mdw(day)}` : day === keys[1] ? `明天 · ${mdw(day)}` : mdw(day);
    children.push({ type: 'text', text: label, title: true }, { type: 'agenda', bars: true, items: take.map(ev => agendaItem(ev, day, tz)) });
  }
  if (!shown) children.push({ type: 'text', text: `接下來 ${days} 天沒有行程`, tone: 'muted' });
  if (hidden) children.push({ type: 'text', text: `還有 ${hidden} 個行程，打開月曆查看`, tone: 'muted' });
  return { type: 'stack', children };
}

const shiftMonth = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n)); return d.toISOString().slice(0, 7); };
const monthDays = ym => { const out = []; for (let d = ym + '-01'; d.startsWith(ym); d = nextDay(d)) out.push(d); return out; };
// Strongest tone on a day, for the 0.2 calendar cell (which has one tone per day).
const RANK = ['error', 'warn', 'accent'];

// §7 `calendar.month`. `events` should cover the whole month. Without `date`, today if it's in `month`, else the 1st.
export function monthView(events, { now = new Date(), tz, month, date }) {
  const today = localTime(now, tz).slice(0, 10);
  month ??= (date ?? today).slice(0, 7);
  date ??= today.startsWith(month) ? today : month + '-01';
  const groups = byDay(events, monthDays(month), tz, now);
  const go = input => ({ tool: 'calendar.month', input });
  const days = [...groups].map(([d, list]) => {
    const live = list.filter(e => e.state !== 'cancelled');
    const tone = RANK.find(t => live.some(e => e.tone === t));
    return {
      date: d,
      ...(list.length && { text: `${list.length} 個` }),
      ...(tone && { tone }),
      action: go({ month, date: d }),
      items: list.slice(0, 20).map(ev => ({
        text: ev.title, ...(ev.tone && { tone: ev.tone }), ...(ev.allday && { allday: true }), ...(ev.strike && { strike: true }),
        action: { tool: 'calendar.event', input: eventInput(ev, tz) },
      })),
    };
  });
  const list = groups.get(date) ?? [];
  return { type: 'stack', children: [
    { type: 'row', align: 'between', children: [
      { type: 'button', label: '‹', action: go({ month: shiftMonth(month, -1) }) },
      { type: 'text', text: `${month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月`, title: true },
      { type: 'button', label: '›', action: go({ month: shiftMonth(month, 1) }) },
      { type: 'button', label: '今天', action: go({ month: today.slice(0, 7), date: today }) },
    ] },
    { type: 'grid', columns: 2, children: [
      { type: 'calendar', month, selected: date, days },
      { type: 'stack', children: [
        { type: 'text', text: `${+date.slice(5, 7)} 月 ${+date.slice(8, 10)} 日（${wd(date)}）`, title: true },
        list.length
          ? { type: 'agenda', bars: true, items: list.map(ev => agendaItem(ev, date, tz)) }
          : { type: 'text', text: '沒有行程', tone: 'muted' },
      ] },
    ] },
    { type: 'row', children: [
      { type: 'badge', text: '進行中', tone: 'accent' }, { type: 'badge', text: '未確認', tone: 'warn' },
      { type: 'badge', text: '時間衝突', tone: 'error' }, { type: 'badge', text: '已取消', tone: 'muted' },
      { type: 'text', text: '底色＝全天', tone: 'muted' },
    ] },
  ] };
}

function span(ev, tz) {
  const s = localTime(ev.start, tz), e = localTime(ev.end, tz);
  if (ev.allday) {
    const last = daysOf(ev, tz).at(-1);
    return last === s.slice(0, 10) ? `${mdw(s.slice(0, 10))} 全天` : `${mdw(s.slice(0, 10))}–${mdw(last)} 全天`;
  }
  const end = s.slice(0, 10) === e.slice(0, 10) ? e.slice(11, 16) : `${mdw(e.slice(0, 10))} ${e.slice(11, 16)}`;
  return `${mdw(s.slice(0, 10))} ${s.slice(11, 16)}–${end}`;
}

// §8 `calendar.event`. `ev` must come from the same day's events so conflicts are known; pass `all` for that.
export function eventView(ev, { now = new Date(), tz, all = [ev] }) {
  const c = classify(all, now).find(e => e.uid === ev.uid && +e.start === +ev.start) ?? classify([ev], now)[0];
  return { type: 'stack', children: [
    { type: 'text', text: c.title || '（無標題）', title: true, ...(c.tone && { tone: c.tone }) },
    ...(c.recurring ? [{ type: 'callout', tone: 'muted', text: '這是重複行程，請在 iPhone 修改' }] : []),
    { type: 'fields', items: [
      { label: '時間', value: span(c, tz) },
      ...(c.location ? [{ label: '地點', value: c.location }] : []),
      ...(c.calendar ? [{ label: '行事曆', value: c.calendar }] : []),
      { label: '狀態', value: STATE_LABEL[c.state] },
    ] },
    ...(c.description ? [{ type: 'text', text: c.description, pre: true }] : []),
    { type: 'row', align: 'end', children: [
      { type: 'button', label: '回到月曆', action: { tool: 'calendar.month', input: { date: localTime(c.start, tz).slice(0, 10) } } },
    ] },
  ] };
}
