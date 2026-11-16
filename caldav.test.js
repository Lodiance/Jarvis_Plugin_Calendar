// CalDAV reading against a fake Radicale (node:http returning fixed XML), plus §5 states and time zones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { listCalendars, fetchEvents, parseEvents, classify, zonedToUtc, localTime, CalDavError } from './caldav.js';

const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Taipei', 'DESCRIPTION:not an event', 'END:VTIMEZONE',
  ...events.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const PROPFIND = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response><href>/alice/</href><propstat><prop><resourcetype><collection/><principal/></resourcetype></prop></propstat></response>
  <response><href>/alice/home/</href><propstat><prop><displayname>Home &amp; Family</displayname>
    <resourcetype><collection/><C:calendar/></resourcetype>
    <C:calendar-timezone>BEGIN:VCALENDAR&#13;
BEGIN:VTIMEZONE&#13;
TZID:Asia/Taipei&#13;
END:VTIMEZONE&#13;
END:VCALENDAR</C:calendar-timezone></prop></propstat></response>
  <response><href>/alice/work%20cal/</href><propstat><prop><displayname/><resourcetype><collection/><C:calendar/></resourcetype></prop></propstat>
    <propstat><prop><C:calendar-timezone/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
</multistatus>`;

const EVENTS = [
  ics(['UID:allday', 'DTSTART;VALUE=DATE:20261116', 'SUMMARY:假日']),
  ics(['UID:overnight', 'DTSTART;TZID=Asia/Taipei:20261116T230000', 'DTEND;TZID=Asia/Taipei:20261117T010000',
    'SUMMARY:A\\, B\\nC & D', 'STATUS:TENTATIVE', 'DESCRIPTION:folded line', ' continues here',
    'BEGIN:VALARM', 'DESCRIPTION:alarm text', 'END:VALARM']),
  ics(['UID:weekly', 'RECURRENCE-ID:20261116T020000Z', 'DTSTART:20261116T020000Z', 'DURATION:PT1H30M', 'SUMMARY:週會'],
      ['UID:weekly', 'RECURRENCE-ID:20261123T020000Z', 'DTSTART:20261123T020000Z', 'DURATION:PT1H30M', 'SUMMARY:週會']),
];
const xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const REPORT = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
${EVENTS.map((e, i) => `<d:response><d:href>/alice/home/${i}.ics</d:href><d:propstat><d:prop><cal:calendar-data>${
  i === 2 ? `<![CDATA[${e}]]>` : xmlEscape(e)}</cal:calendar-data></d:prop></d:propstat></d:response>`).join('')}
</d:multistatus>`;

let server, url;
const seen = [];
const creds = () => ({ url, user: 'alice', password: 's3cret' });

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; }).on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.headers.authorization !== 'Basic ' + Buffer.from('alice:s3cret').toString('base64')) { res.writeHead(401).end(); return; }
      res.writeHead(207, { 'content-type': 'application/xml' }).end(req.method === 'PROPFIND' ? PROPFIND : REPORT);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/alice/`;
});
after(() => server.close());

test('PROPFIND lists only calendar collections, with names and time zone', async () => {
  const cals = await listCalendars(creds());
  const req = seen.at(-1);
  assert.equal(req.method, 'PROPFIND');
  assert.equal(req.headers.depth, '1');
  assert.deepEqual(cals, [
    { href: `${url}home/`, name: 'Home & Family', timezone: 'Asia/Taipei' },
    { href: `${url}work%20cal/`, name: 'work cal', timezone: undefined },
  ]);
});

test('REPORT asks for an expanded time range and parses every event', async () => {
  const from = new Date('2026-11-15T16:00:00Z'), to = new Date('2026-11-30T16:00:00Z');
  const evs = await fetchEvents({ href: `${url}home/`, name: 'Home' }, creds(), from, to, 'Asia/Taipei');
  const req = seen.at(-1);
  assert.equal(req.method, 'REPORT');
  assert.match(req.body, /<C:expand start="20261115T160000Z" end="20261130T160000Z"\/>/);
  assert.match(req.body, /<C:time-range start="20261115T160000Z" end="20261130T160000Z"\/>/);

  const [allday, overnight, w1, w2] = evs;
  assert.equal(evs.length, 4);
  // all-day: midnight to midnight in the display time zone, no DTEND means one day
  assert.deepEqual([allday.allday, allday.start.toISOString(), allday.end.toISOString()],
    [true, '2026-11-15T16:00:00.000Z', '2026-11-16T16:00:00.000Z']);
  // crosses midnight; TZID converted; text unescaped; folded line joined; VALARM/VTIMEZONE ignored
  assert.deepEqual([overnight.start.toISOString(), overnight.end.toISOString()], ['2026-11-16T15:00:00.000Z', '2026-11-16T17:00:00.000Z']);
  assert.equal(overnight.title, 'A, B\nC & D');
  assert.equal(overnight.description, 'folded linecontinues here');
  assert.equal(overnight.status, 'TENTATIVE');
  assert.equal(overnight.calendar, 'Home');
  // recurring: two expanded instances, DURATION applied
  assert.deepEqual([w1, w2].map(e => [e.uid, e.recurring, e.start.toISOString(), e.end.toISOString()]), [
    ['weekly', true, '2026-11-16T02:00:00.000Z', '2026-11-16T03:30:00.000Z'],
    ['weekly', true, '2026-11-23T02:00:00.000Z', '2026-11-23T03:30:00.000Z'],
  ]);
  assert.equal(allday.recurring, false);
});

test('wrong password is a 401 CalDavError that does not leak secrets', async () => {
  await assert.rejects(listCalendars({ ...creds(), password: 'nope' }), e =>
    e instanceof CalDavError && e.status === 401 && !/nope|alice|127\.0\.0\.1/.test(e.message));
});

test('unreachable server is a status-0 CalDavError', async () => {
  await assert.rejects(listCalendars({ ...creds(), url: 'http://127.0.0.1:1/' }), e => e instanceof CalDavError && e.status === 0);
});

test('time zones: DST, floating times, unknown TZID', () => {
  assert.equal(zonedToUtc('2026-07-01T12:00', 'Europe/London').toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01T12:00', 'Europe/London').toISOString(), '2026-12-01T12:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-16', 'Asia/Taipei').toISOString(), '2026-11-15T16:00:00.000Z');
  assert.equal(localTime(new Date('2026-11-16T15:30:00Z'), 'Asia/Taipei'), '2026-11-16T23:30:00');
  const [floating, outlook] = parseEvents(ics(
    ['UID:f', 'DTSTART:20261116T090000', 'DTEND:20261116T100000'],
    ['UID:o', 'DTSTART;TZID="Taipei Standard Time":20261116T090000'],
  ), 'Asia/Taipei');
  assert.equal(floating.start.toISOString(), '2026-11-16T01:00:00.000Z');
  assert.equal(outlook.start.toISOString(), '2026-11-16T01:00:00.000Z');
  assert.equal(+outlook.end, +outlook.start); // no DTEND/DURATION on a timed event
});

test('§5: each event gets exactly one state, first match wins', () => {
  const t = h => new Date(Date.UTC(2026, 10, 16, h));
  const ev = (uid, s, e, extra = {}) => ({ uid, start: t(s), end: t(e), allday: false, status: '', ...extra });
  const out = classify([
    ev('cancelled', 1, 2, { status: 'CANCELLED' }),
    ev('clashA', 3, 5), ev('clashB', 4, 6, { status: 'TENTATIVE' }),
    ev('cancelledOverlap', 3, 5, { status: 'CANCELLED' }), // cancelled events don't cause conflicts
    ev('tentative', 7, 8, { status: 'TENTATIVE' }),
    ev('ongoing', 9, 11),
    ev('ended', 0, 1),
    ev('normal', 12, 13),
    ev('allday', 0, 24, { allday: true }), // overlaps everything, but never a conflict
  ], t(10));
  assert.deepEqual(Object.fromEntries(out.map(e => [e.uid, [e.state, e.tone, e.strike]])), {
    cancelled: ['cancelled', 'muted', true],
    clashA: ['conflict', 'error', undefined],
    clashB: ['conflict', 'error', undefined],
    cancelledOverlap: ['cancelled', 'muted', true],
    tentative: ['tentative', 'warn', undefined],
    ongoing: ['ongoing', 'accent', undefined],
    ended: ['ended', 'muted', undefined],
    normal: ['normal', undefined, undefined],
    allday: ['ongoing', 'accent', undefined],
  });
});
