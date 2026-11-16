// calendar: a Jarvis plugin (spec 0.2, spec/plugin-spec.md in the Jarvis repo).
// A card that lists notes and a form that adds one. Replace both with your own.
import fs from 'node:fs';
import path from 'node:path';
import { servePlugin } from './plugin-kit.js';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url)));
// DATA_DIR is the only folder this plugin may write. The host creates it; it survives restarts and updates.
const FILE = path.join(process.env.DATA_DIR, 'notes.json');
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };

servePlugin({
  manifest,
  cards: {
    main() {
      const notes = load();
      return {
        updated_at: new Date().toISOString(),
        view: {
          type: 'stack', children: [
            { type: 'list', empty: '還沒有筆記', items: notes.slice(-5).reverse().map(n => ({ text: n.text, meta: n.at.slice(0, 10) })) },
            // Field names are the tool's parameters; the host checks them against the manifest before calling.
            { type: 'form', submit: { tool: 'calendar.add', label: '新增' }, children: [
              { type: 'input', name: 'text', label: '筆記', required: true, max_length: 200 },
            ] },
          ],
        },
      };
    },
  },
  tools: {
    // `internal`: changes only this plugin's data, so it runs without asking. After it succeeds the host
    // fetches this plugin's cards again, so the new note shows right away.
    'calendar.add'({ text }) {
      const t = String(text ?? '').trim();
      if (!t) throw new Error('筆記不能是空的');
      const notes = load();
      notes.push({ text: t.slice(0, 200), at: new Date().toISOString() });
      fs.writeFileSync(FILE, JSON.stringify(notes));
      return { result: { added: t, count: notes.length }, notice: '已新增' };
    },
  },
});
