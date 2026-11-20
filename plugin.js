// calendar: a Jarvis plugin (spec/calendar-spec.md; host contract: spec/plugin-spec.md in the Jarvis repo).
// The `upcoming` card; read tools (v0.1) and write tools, form and settings (v0.2).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { servePlugin } from './plugin-kit.js';
import {
  listCalendars, makeCalendar, fetchEvents, findEvent, putEvent, deleteEvent, isRecurring, parseEvents,
  newEventIcs, editEventIcs, localTime, zonedToUtc, nextDay, CalDavError,
} from './caldav.js';
import { upcomingView, monthView, eventView, formView, settingsView } from './views.js';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)));
const MAX_RANGE_DAYS = 62;
const SETUP = '尚未設定 Radicale 連線，到 #/dev/plugins 填寫網址、帳號和密碼';
const RECURRING = '這是重複行程，請在 iPhone 修改';

const DAY = /^\d{4}-\d\d-\d\d$/, WHEN = /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/, MONTH = /^\d{4}-\d\d$/;
function arg(v, re, name) {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || !re.test(v) || Number.isNaN(Date.parse(v.slice(0, 10)))) throw new Error(`${name} 格式不對：${String(v).slice(0, 40)}`);
  return v;
}
function str(v, max, name) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`${name} 要是文字`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${name} 最多 ${max} 字`);
  return s;
}
const validTz = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const pick = (cals, want) => want && cals.find(c => c.name === want || c.href === want || new URL(c.href).pathname === want);

// Local form/AI times → what caldav.js writes. All-day `end` comes in as the last day (inclusive) and goes out
// exclusive; a missing end is the same day, or one hour for timed events.
function resolveTimes({ allday, start, end }, tz) {
  if (allday) {
    const s = start.slice(0, 10), last = (end ?? s).slice(0, 10);
    if (last < s) throw new Error('結束要在開始之後');
    return { allday: true, start: s, end: nextDay(last) };
  }
  if (DAY.test(start)) throw new Error('start 要有時間（YYYY-MM-DDTHH:MM），或設 allday');
  if (end && DAY.test(end)) throw new Error('end 要有時間（YYYY-MM-DDTHH:MM）');
  const s = zonedToUtc(start, tz), e = end ? zonedToUtc(end, tz) : new Date(+s + 36e5);
  if (e <= s) throw new Error('結束要在開始之後');
  return { allday: false, start: s, end: e };
}

// Kit 0.4 hands every handler this request's secrets { caldav_url, caldav_user, caldav_password } ({} when unset):
// cards as (secrets), tools as (input, secrets). clock() → now; dataDir holds settings.json (§4).
export function app(clock = () => new Date(), dataDir = process.env.DATA_DIR) {
  const creds = (s = {}) =>
    s.caldav_url && s.caldav_user && s.caldav_password ? { url: s.caldav_url, user: s.caldav_user, password: s.caldav_password } : null;
  const need = s => { const c = creds(s); if (!c) throw new Error(SETUP); return c; };

  // A broken or missing file means defaults; the card must never fail on it.
  const file = dataDir && path.join(dataDir, 'settings.json');
  const settings = () => {
    try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; } catch { return {}; }
  };
  const daysOf = s => (Number.isInteger(s.days) && s.days >= 1 && s.days <= 14 ? s.days : 3);
  const tzOf = cals => {
    const t = settings().timezone;
    return (typeof t === 'string' && validTz(t) && t) || cals.find(k => k.timezone)?.timezone || 'Europe/London';
  };

  // Every calendar's events overlapping [from, to) in the display time zone (§2 時區).
  async function load(c, from, to) {
    const cals = await listCalendars(c);
    const tz = tzOf(cals);
    const lists = await Promise.all(cals.map(k => fetchEvents(k, c, from(tz), to(tz), tz)));
    const events = lists.flat().filter(e => e.start < to(tz) && (e.end > from(tz) || +e.end === +e.start && e.start >= from(tz)));
    return { cals, tz, events };
  }

  // The stored, non-recurring event behind `uid`, ready to edit.
  async function target(c, uid) {
    if (typeof uid !== 'string' || !uid) throw new Error('uid 必填');
    const cals = await listCalendars(c);
    const tz = tzOf(cals);
    const hit = await findEvent(cals, c, uid);
    if (!hit) throw new Error('找不到這個行程，可能已經被刪除');
    if (isRecurring(hit.ics)) throw new Error(RECURRING);
    return { tz, hit, ev: { ...parseEvents(hit.ics, tz)[0], calendar: hit.cal.name } };
  }

  // §2: on 412 don't retry; show the current version instead.
  async function conflict(c, uid) {
    const cals = await listCalendars(c);
    const tz = tzOf(cals);
    const hit = await findEvent(cals, c, uid);
    if (!hit) return { result: { conflict: true, deleted: true, uid }, notice: '行程已經在別處被刪除' };
    const ev = { ...parseEvents(hit.ics, tz)[0], calendar: hit.cal.name };
    return { result: { conflict: true, uid }, view: eventView(ev, { now: clock(), tz }), notice: '行程在別處被改過，已重新載入' };
  }
  const on412 = (c, uid) => e => { if (e instanceof CalDavError && e.status === 412) return conflict(c, uid); throw e; };

  // §9: after a write, back to that day's month view with a notice.
  async function after(secrets, day, notice, result) {
    const { view } = await tools['calendar.month']({ date: day }, secrets);
    return { result, view, notice };
  }
  const dayOf = (times, tz) => (times.allday ? times.start : localTime(times.start, tz).slice(0, 10));

  const tools = {
    async 'calendar.list'({ from, to } = {}, secrets) {
      const c = need(secrets), now = clock();
      const f = arg(from, WHEN, 'from');
      const t = arg(to, WHEN, 'to');
      const start = tz => zonedToUtc(f ?? localTime(now, tz).slice(0, 10), tz);
      const end = tz => { const v = t ?? (f ?? localTime(now, tz)).slice(0, 10); return zonedToUtc(DAY.test(v) ? nextDay(v) : v, tz); };
      // Range check needs a zone; the 62-day cap doesn't care which one.
      const span = (end('UTC') - start('UTC')) / 864e5;
      if (!(span > 0)) throw new Error('to 要晚於 from');
      if (span > MAX_RANGE_DAYS) throw new Error(`區間最多 ${MAX_RANGE_DAYS} 天`);
      const { tz, events } = await load(c, start, end);
      const local = d => localTime(d, tz).slice(0, 16);
      const lastDay = e => localTime(new Date(Math.max(+e.start, +e.end - 1)), tz).slice(0, 10);
      events.sort((a, b) => a.start - b.start);
      return {
        result: events.map(e => ({
          uid: e.uid, start: e.allday ? local(e.start).slice(0, 10) : local(e.start), end: e.allday ? lastDay(e) : local(e.end),
          allday: e.allday, title: e.title, status: e.status, location: e.location, calendar: e.calendar, recurring: e.recurring,
        })),
      };
    },

    async 'calendar.month'({ month, date } = {}, secrets) {
      const c = need(secrets), now = clock();
      let m = arg(month, MONTH, 'month');
      const d = arg(date, DAY, 'date');
      m ??= d?.slice(0, 7);
      const ym = tz => m ?? localTime(now, tz).slice(0, 7);
      const first = tz => zonedToUtc(ym(tz) + '-01', tz);
      const next = tz => zonedToUtc(new Date(Date.UTC(+ym(tz).slice(0, 4), +ym(tz).slice(5, 7))).toISOString().slice(0, 10), tz);
      const { tz, events } = await load(c, first, next);
      const view = monthView(events, { now, tz, month: m, date: d });
      const shown = view.children[1].children[0];
      return { result: { month: shown.month, date: shown.selected, events: events.length }, view };
    },

    async 'calendar.event'({ uid, start } = {}, secrets) {
      const c = need(secrets), now = clock();
      if (typeof uid !== 'string' || !uid) throw new Error('uid 必填');
      const s = arg(start, WHEN, 'start');
      if (!s) throw new Error('start 必填');
      const day = s.slice(0, 10);
      const { tz, events } = await load(c, tz => zonedToUtc(day, tz), tz => zonedToUtc(nextDay(day), tz));
      const ev = events.find(e => e.uid === uid && localTime(e.start, tz).startsWith(s));
      if (!ev) throw new Error('找不到這個行程，可能已經被刪除或改了時間');
      return {
        result: { uid: ev.uid, title: ev.title, start: s, location: ev.location, description: ev.description, calendar: ev.calendar, recurring: ev.recurring, status: ev.status },
        view: eventView(ev, { now, tz, all: events }),
      };
    },

    async 'calendar.form'({ date, uid } = {}, secrets) {
      const c = need(secrets);
      if (uid) {
        const { tz, ev } = await target(c, uid);
        return { result: { uid, title: ev.title }, view: formView({ ev, tz }) };
      }
      const cals = await listCalendars(c);
      const tz = tzOf(cals);
      const d = arg(date, DAY, 'date') ?? localTime(clock(), tz).slice(0, 10);
      return { result: { date: d }, view: formView({ date: d, tz, cals, calendar: pick(cals, settings().calendar)?.name }) };
    },

    async 'calendar.create'(input = {}, secrets) {
      const c = need(secrets), now = clock();
      const title = str(input.title, 200, 'title');
      if (!title) throw new Error('title 必填');
      const start = arg(input.start, WHEN, 'start');
      if (!start) throw new Error('start 必填');
      const cals = await listCalendars(c);
      if (!cals.length) throw new Error('Radicale 上沒有行事曆');
      const tz = tzOf(cals);
      const cal = input.calendar ? pick(cals, input.calendar) : pick(cals, settings().calendar) || cals[0];
      if (!cal) throw new Error(`沒有叫「${String(input.calendar).slice(0, 40)}」的行事曆`);
      const times = resolveTimes({ allday: input.allday ?? DAY.test(start), start, end: arg(input.end, WHEN, 'end') }, tz);
      const uid = randomUUID();
      await putEvent(new URL(uid + '.ics', cal.href.replace(/\/?$/, '/')).href, c,
        newEventIcs(uid, { title, location: str(input.location, 200, 'location'), notes: str(input.notes, 4000, 'notes'), times }, now));
      return after(secrets, dayOf(times, tz), `已新增「${title}」`, { uid, title, calendar: cal.name });
    },

    async 'calendar.update'(input = {}, secrets) {
      const c = need(secrets), now = clock();
      const { tz, hit, ev } = await target(c, input.uid);
      const f = { title: str(input.title, 200, 'title'), location: str(input.location, 200, 'location'), notes: str(input.notes, 4000, 'notes') };
      if (f.title === '') throw new Error('標題不能是空的');
      const s = arg(input.start, WHEN, 'start'), e = arg(input.end, WHEN, 'end');
      if (input.allday !== undefined || s || e) {
        const allday = input.allday ?? ev.allday;
        const curStart = localTime(ev.start, tz).slice(0, ev.allday ? 10 : 16);
        const curEnd = ev.allday ? localTime(new Date(Math.max(+ev.start, +ev.end - 1)), tz).slice(0, 10) : localTime(ev.end, tz).slice(0, 16);
        // Only the end moved: keep the start. Start or all-day changed without an end: §9 default end.
        f.times = resolveTimes({ allday, start: s ?? curStart, end: e ?? (!s && input.allday === undefined ? curEnd : undefined) }, tz);
      }
      if (Object.values(f).every(v => v === undefined)) throw new Error('沒有要改的欄位');
      const done = await putEvent(hit.href, c, editEventIcs(hit.ics, f, now), hit.etag).then(() => null, on412(c, ev.uid));
      if (done) return done;
      return after(secrets, f.times ? dayOf(f.times, tz) : localTime(ev.start, tz).slice(0, 10), `已更新「${f.title ?? ev.title}」`, { uid: ev.uid });
    },

    async 'calendar.delete'({ uid } = {}, secrets) {
      const c = need(secrets);
      const { tz, hit, ev } = await target(c, uid);
      const done = await deleteEvent(hit.href, c, hit.etag).then(() => null, on412(c, ev.uid));
      if (done) return done;
      return after(secrets, localTime(ev.start, tz).slice(0, 10), `已刪除「${ev.title}」`, { uid: ev.uid, deleted: true });
    },

    // §4. No parameters: return the form. Empty timezone/calendar clears that setting.
    async 'calendar.settings'(input = {}, secrets) {
      const s = settings();
      if (['timezone', 'days', 'calendar'].every(k => input[k] === undefined)) {
        const c = creds(secrets);
        const cals = c ? await listCalendars(c).catch(() => []) : [];
        return { result: s, view: settingsView({ settings: s, days: daysOf(s), cals }) };
      }
      if (input.timezone !== undefined) {
        const tz = str(input.timezone, 60, 'timezone');
        if (!tz) delete s.timezone;
        else if (!validTz(tz)) throw new Error(`不認得的時區：${tz}`);
        else s.timezone = tz;
      }
      if (input.days !== undefined) {
        if (!Number.isInteger(input.days) || input.days < 1 || input.days > 14) throw new Error('days 要是 1–14 的整數');
        s.days = input.days;
      }
      if (input.calendar !== undefined) {
        const v = str(input.calendar, 200, 'calendar');
        if (v) s.calendar = v; else delete s.calendar;
      }
      // Write-then-rename so a stop mid-write (backups stop the container) never leaves half a file.
      fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 2));
      fs.renameSync(file + '.tmp', file);
      return { result: s, notice: '已儲存設定' };
    },
  };

  // Spec 0.4 /health `setup`: the install wizard's "test connection". Missing → that field; then one PROPFIND.
  // A Radicale just deployed by the wizard (spec 0.5 `services`) has an empty account: make the first calendar
  // here. Only when there is none, so a second test finds it and makes nothing.
  async function setup(s = {}) {
    const field = ['caldav_url', 'caldav_user', 'caldav_password'].find(k => !s[k]);
    if (field) return { ok: false, error: '還沒填完 Radicale 的網址、帳號和密碼', field };
    if (!URL.canParse(s.caldav_url)) return { ok: false, error: '網址格式不對', field: 'caldav_url' };
    try {
      const c = creds(s);
      if (!(await listCalendars(c)).length) {
        try { await makeCalendar(c, '行事曆'); } catch (e) { if (!(e instanceof CalDavError) || e.status === 401) throw e; }
        if (!(await listCalendars(c)).length) return { ok: false, error: '這個網址底下沒有行事曆，也沒辦法建立：網址要指到帳號那一層（結尾要有 /）', field: 'caldav_url' };
      }
      return { ok: true };
    } catch (e) {
      if (!(e instanceof CalDavError)) throw e;
      return { ok: false, error: e.message, field: e.status === 401 ? 'caldav_password' : 'caldav_url' };
    }
  }

  return {
    setup,
    cards: {
      async upcoming(secrets) {
        const c = creds(secrets);
        const callout = (tone, text) => ({ updated_at: new Date().toISOString(), view: { type: 'callout', tone, text } });
        if (!c) return callout('warn', SETUP);
        const now = clock(), days = daysOf(settings());
        try {
          const { tz, events } = await load(c,
            tz => zonedToUtc(localTime(now, tz).slice(0, 10), tz),
            tz => { let d = localTime(now, tz).slice(0, 10); for (let i = 0; i < days; i++) d = nextDay(d); return zonedToUtc(d, tz); });
          return { updated_at: now.toISOString(), view: upcomingView(events, { now, tz, days }) };
        } catch (e) {
          if (e instanceof CalDavError && e.status === 401) return callout('error', 'Radicale 帳號或密碼錯誤，到 #/dev/plugins 更新');
          throw e; // non-2xx: the host keeps showing the last snapshot
        }
      },
    },
    tools,
  };
}

if (import.meta.main) {
  servePlugin({ manifest, ...app() });
}
