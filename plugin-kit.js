// Jarvis plugin kit, spec 0.3 (spec/plugin-spec.md). Copy this file into your plugin folder; do not edit the copy.
// The canonical version lives in the Jarvis repo at plugin-kit/plugin-kit.js, and its tests check that the
// example plugins carry an identical copy.
//
// Serves the four endpoints the Jarvis host calls (ADR 0008):
//   GET /manifest   GET /cards/:id   POST /tools/:name   GET /health
// Every request must carry the x-plugin-key the host gave this process; anything else gets 401.
import http from 'node:http';

// The plugin spec this copy of the kit was written for. `npm run plugin:check` compares a plugin's copy with
// the host's and names both versions when they differ.
export const KIT_SPEC = '0.3';

export function servePlugin({ manifest, cards = {}, tools = {} }) {
  const key = process.env.PLUGIN_KEY;
  if (!key) throw new Error('PLUGIN_KEY is not set; plugins are started by the Jarvis host');
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  http.createServer(async (req, res) => {
    if (req.headers['x-plugin-key'] !== key) return send(res, 401, { error: 'bad plugin key' });
    const { pathname } = new URL(req.url, 'http://plugin');
    // ADR 0012: only the secret names this manifest declares and the person has filled in, never logged here.
    let secrets = {};
    const secretsHeader = req.headers['x-plugin-secrets'];
    if (secretsHeader) { try { secrets = JSON.parse(Buffer.from(String(secretsHeader), 'base64url').toString('utf8')); } catch {} }
    try {
      if (req.method === 'GET' && pathname === '/manifest') return send(res, 200, manifest);
      if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, version: manifest.version });
      const card = /^\/cards\/([^/]+)$/.exec(pathname);
      if (req.method === 'GET' && card) {
        if (!cards[card[1]]) return send(res, 404, { error: 'no such card' });
        return send(res, 200, await cards[card[1]](secrets));
      }
      const tool = /^\/tools\/([^/]+)$/.exec(pathname);
      if (req.method === 'POST' && tool) {
        const name = decodeURIComponent(tool[1]);
        if (!tools[name]) return send(res, 404, { error: 'no such tool' });
        let raw = '';
        for await (const chunk of req) raw += chunk;
        return send(res, 200, await tools[name](raw ? JSON.parse(raw) : {}, secrets));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  }).listen(Number(process.env.PORT), process.env.HOST ?? '127.0.0.1');

  // On a PC the host runs plugins as child processes and keeps our stdin open. When the host exits, even
  // by a crash, the pipe closes and we leave too instead of lingering on a port nobody calls.
  if (process.env.PLUGIN_EXIT_WITH_HOST === '1') {
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('error', () => process.exit(0));
    process.stdin.resume();
  }
}
