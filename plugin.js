// calendar: a Jarvis plugin (spec/calendar-spec.md; host contract: spec/plugin-spec.md in the Jarvis repo).
// Read-only v0.1: the `upcoming` card and calendar.list / calendar.month / calendar.event.
import fs from 'node:fs';
import { servePlugin } from './plugin-kit.js';
import { listCalendars, fetchEvents, localTime, zonedToUtc, nextDay, CalDavError } from './caldav.js';
import { upcomingView, monthView, eventView } from './views.js';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)));
const DAYS = 3;
const MAX_RANGE_DAYS = 62;
const SETUP = '尚未設定 Radicale 連線，到 #/dev/plugins 填寫網址、帳號和密碼';

const DAY = /^\d{4}-\d\d-\d\d$/, WHEN = /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/, MONTH = /^\d{4}-\d\d$/;
function arg(v, re, name) {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || !re.test(v) || Number.isNaN(Date.parse(v.slice(0, 10)))) throw new Error(`${name} 格式不對：${String(v).slice(0, 40)}`);
  return v;
}

// getSecrets() → { caldav_url, caldav_user, caldav_password } for the current request; clock() → now.
export function app(getSecrets, clock = () => new Date()) {
  const creds = () => {
    const s = getSecrets() ?? {};
    return s.caldav_url && s.caldav_user && s.caldav_password ? { url: s.caldav_url, user: s.caldav_user, password: s.caldav_password } : null;
  };
  const need = () => { const c = creds(); if (!c) throw new Error(SETUP); return c; };

  // Every calendar's events overlapping [from, to), plus the display time zone (§2 時區).
  async function load(c, from, to) {
    const cals = await listCalendars(c);
    const tz = cals.find(k => k.timezone)?.timezone ?? 'Europe/London';
    const lists = await Promise.all(cals.map(k => fetchEvents(k, c, from(tz), to(tz), tz)));
    const events = lists.flat().filter(e => e.start < to(tz) && (e.end > from(tz) || +e.end === +e.start && e.start >= from(tz)));
    return { tz, events };
  }

  return {
    cards: {
      async upcoming() {
        const c = creds();
        const callout = (tone, text) => ({ updated_at: new Date().toISOString(), view: { type: 'callout', tone, text } });
        if (!c) return callout('warn', SETUP);
        const now = clock();
        try {
          const { tz, events } = await load(c,
            tz => zonedToUtc(localTime(now, tz).slice(0, 10), tz),
            tz => { let d = localTime(now, tz).slice(0, 10); for (let i = 0; i < DAYS; i++) d = nextDay(d); return zonedToUtc(d, tz); });
          return { updated_at: now.toISOString(), view: upcomingView(events, { now, tz, days: DAYS }) };
        } catch (e) {
          if (e instanceof CalDavError && e.status === 401) return callout('error', 'Radicale 帳號或密碼錯誤，到 #/dev/plugins 更新');
          throw e; // non-2xx: the host keeps showing the last snapshot
        }
      },
    },
    tools: {
      async 'calendar.list'({ from, to } = {}) {
        const c = need(), now = clock();
        const f = arg(from, WHEN, 'from');
        const t = arg(to, WHEN, 'to');
        const start = tz => zonedToUtc(f ?? localTime(now, tz).slice(0, 10), tz);
        const end = tz => { const v = t ?? (f ?? localTime(now, tz)).slice(0, 10); return zonedToUtc(DAY.test(v) ? nextDay(v) : v, tz); };
        // Range check needs a zone; the 62-day cap doesn't care which one.
        const span = (end('UTC') - start('UTC')) / 864e5;
        if (!(span > 0)) throw new Error('to 要晚於 from');
        if (span > MAX_RANGE_DAYS) throw new Error(`區間最多 ${MAX_RANGE_DAYS} 天`);
        const { tz, events } = await load(c, start, end);
        const local = (d, allday) => allday ? localTime(d, tz).slice(0, 10) : localTime(d, tz).slice(0, 16);
        events.sort((a, b) => a.start - b.start);
        return {
          result: events.map(e => ({
            uid: e.uid, start: local(e.start, e.allday), end: local(e.end, e.allday), allday: e.allday, title: e.title,
            status: e.status, location: e.location, calendar: e.calendar, recurring: e.recurring,
          })),
        };
      },

      async 'calendar.month'({ month, date } = {}) {
        const c = need(), now = clock();
        let m = arg(month, MONTH, 'month');
        const d = arg(date, DAY, 'date');
        m ??= d?.slice(0, 7);
        const first = tz => zonedToUtc((m ?? localTime(now, tz).slice(0, 7)) + '-01', tz);
        const next = tz => { const ym = m ?? localTime(now, tz).slice(0, 7); const n = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7))); return zonedToUtc(n.toISOString().slice(0, 10), tz); };
        const { tz, events } = await load(c, first, next);
        const view = monthView(events, { now, tz, month: m, date: d });
        const shown = view.children[1].children[0];
        return { result: { month: shown.month, date: shown.selected, events: events.length }, view };
      },

      async 'calendar.event'({ uid, start } = {}) {
        const c = need(), now = clock();
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
    },
  };
}

if (import.meta.main) {
  // WIP(2026-11-16): host spec 0.3 delivers secrets in the x-plugin-secrets header and kit 0.3 hands them to
  // handlers; kit 0.2 can't, so the card says "not set up" until the kit is replaced. Swap this getter then.
  servePlugin({ manifest, ...app(() => ({})) });
}
