// CalDAV client and the slice of iCalendar this plugin reads (spec §2 讀取/時區, §5 狀態). No dependencies.
// creds = { url, user, password } (the three secrets). Error messages never include them or the URL.

export class CalDavError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const NS = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"';

async function dav(method, url, { user, password }, body) {
  let res;
  try {
    res = await fetch(url, {
      method, body, signal: AbortSignal.timeout(6000),
      headers: {
        authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'),
        depth: '1', 'content-type': 'application/xml; charset=utf-8',
      },
    });
  } catch (e) {
    throw new CalDavError(0, e.name === 'TimeoutError' ? '連線 Radicale 逾時' : '無法連線 Radicale');
  }
  if (res.status === 401) throw new CalDavError(401, 'Radicale 帳號或密碼錯誤');
  if (res.status !== 207) throw new CalDavError(res.status, `Radicale 回應 ${res.status}`);
  return res.text();
}

// ponytail: regex XML reading, enough for a multistatus (no nested same-name elements). Swap for a real
// parser if a server ever sends something stranger than Radicale does.
const els = (xml, name) => [...xml.matchAll(new RegExp(
  `<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'g'))].map(m => m[1] ?? '');
const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unxml = (s = '') => {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  if (cdata) return cdata[1];
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, e) =>
    e[0] !== '#' ? ENT[e.toLowerCase()] ?? all
      : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));
};

// `url` may be the user's calendar home or a single calendar; both come back as a list.
export async function listCalendars(creds) {
  const xml = await dav('PROPFIND', creds.url, creds,
    `<?xml version="1.0" encoding="utf-8"?><D:propfind ${NS}><D:prop><D:displayname/><D:resourcetype/><C:calendar-timezone/></D:prop></D:propfind>`);
  return els(xml, 'response').flatMap(r => {
    if (!els(els(r, 'resourcetype')[0] ?? '', 'calendar').length) return [];
    const href = new URL(unxml(els(r, 'href')[0]).trim(), creds.url).href;
    const name = unxml(els(r, 'displayname')[0]).trim() || decodeURIComponent(href.split('/').filter(Boolean).pop());
    const timezone = unxml(els(r, 'calendar-timezone')[0]).match(/^TZID:(.+)$/m)?.[1].trim();
    return [{ href, name, timezone }];
  });
}

// Radicale expands recurring events into one VEVENT per occurrence, so no RRULE handling here.
export async function fetchEvents(cal, creds, from, to, tz) {
  const t = d => d.toISOString().replace(/[-:]|\.\d+/g, '');
  const range = `start="${t(from)}" end="${t(to)}"`;
  const xml = await dav('REPORT', cal.href, creds,
    `<?xml version="1.0" encoding="utf-8"?><C:calendar-query ${NS}><D:prop><C:calendar-data><C:expand ${range}/></C:calendar-data></D:prop>` +
    `<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range ${range}/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`);
  return els(xml, 'calendar-data').flatMap(d => parseEvents(unxml(d), tz)).map(e => ({ ...e, calendar: cal.name }));
}

// --- iCalendar ---

const text = p => p?.value.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)) ?? '';
export const nextDay = ymd => new Date(Date.parse(ymd + 'T00:00Z') + 864e5).toISOString().slice(0, 10);

function duration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  return (sign === '-' ? -1 : 1) * ((((+w * 7 + +d) * 24 + +h) * 60 + +mi) * 60 + +s) * 1000;
}

// Floating times and all-day dates are read in `tz`; unknown TZIDs (e.g. Outlook names) fall back to it too.
function time(p, tz) {
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = p.value.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?/);
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (z) return new Date(local + 'Z');
  try { return zonedToUtc(local, p.params.TZID ?? tz); } catch { return zonedToUtc(local, tz); }
}

export function parseEvents(ics, tz) {
  const out = [];
  let ev = null, depth = 0;
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+)((?:;(?:"[^"]*"|[^:;"])*)*):(.*)$/);
    if (!m) continue;
    const [, rawName, rawParams, value] = m;
    const name = rawName.toUpperCase();
    if (name === 'BEGIN') { if (ev) depth++; else if (value.trim() === 'VEVENT') { ev = {}; depth = 1; } continue; }
    if (name === 'END') { if (ev && --depth === 0) { out.push(toEvent(ev, tz)); ev = null; } continue; }
    if (!ev || depth !== 1) continue; // skip VCALENDAR/VTIMEZONE props and nested VALARMs
    const params = Object.fromEntries([...rawParams.matchAll(/;([\w-]+)=("[^"]*"|[^;]*)/g)]
      .map(([, k, v]) => [k.toUpperCase(), v.replace(/^"|"$/g, '')]));
    ev[name] = { value, params };
  }
  return out;
}

function toEvent(p, tz) {
  const allday = p.DTSTART.params.VALUE === 'DATE' || p.DTSTART.value.length === 8;
  const start = time(p.DTSTART, tz);
  const end = p.DTEND ? time(p.DTEND, tz)
    : p.DURATION ? new Date(+start + duration(p.DURATION.value))
    : allday ? zonedToUtc(nextDay(p.DTSTART.value.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')), tz)
    : start;
  return {
    uid: text(p.UID), title: text(p.SUMMARY), start, end, allday,
    status: (p.STATUS?.value ?? '').toUpperCase(),
    location: text(p.LOCATION), description: text(p.DESCRIPTION),
    recurring: !!(p.RRULE || p['RECURRENCE-ID']),
  };
}

// --- time zones ---

// Wall-clock time of `date` in `tz` as 'YYYY-MM-DDTHH:MM:SS'.
export const localTime = (date, tz) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(date).replace(' ', 'T');

// 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DDTHH:MM:SS' read as wall-clock time in `tz`.
export function zonedToUtc(local, tz) {
  const [d, t = '00:00'] = local.split('T');
  const naive = Date.parse(`${d}T${t.length === 5 ? t + ':00' : t}Z`);
  if (Number.isNaN(naive)) throw new RangeError(`bad time: ${local}`);
  const offset = at => Date.parse(localTime(new Date(at), tz) + 'Z') - at;
  return new Date(naive - offset(naive - offset(naive))); // second pass settles which side of a DST change
}

// --- §5 status: one per event, first match wins ---

export function classify(events, now = new Date()) {
  const busy = events.filter(e => !e.allday && e.status !== 'CANCELLED');
  return events.map(e => ({
    ...e,
    ...(e.status === 'CANCELLED' ? { state: 'cancelled', tone: 'muted', strike: true }
      : !e.allday && busy.some(o => o !== e && o.start < e.end && e.start < o.end) ? { state: 'conflict', tone: 'error' }
      : e.status === 'TENTATIVE' ? { state: 'tentative', tone: 'warn' }
      : e.start <= now && now < e.end ? { state: 'ongoing', tone: 'accent' }
      : e.end <= now ? { state: 'ended', tone: 'muted' }
      : { state: 'normal' }),
  }));
}
