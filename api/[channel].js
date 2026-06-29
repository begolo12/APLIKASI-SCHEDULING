// Vercel serverless function — FlowBoard API (Neon Postgres)
// Mirrors vite-neon-api.js & electron/ipc.js handler surface.
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sql;

function getSql() {
  if (!sql) {
    if (!process.env.NEON_DATABASE_URL) {
      throw new Error('NEON_DATABASE_URL environment variable is missing');
    }
    sql = neon(process.env.NEON_DATABASE_URL);
  }
  return sql;
}

// ---------------- helpers ----------------
function hashPw(p) { return crypto.createHash('sha256').update(p).digest('hex'); }
function cleanStr(v, max = 200) { if (v == null) return ''; const s = String(v); return s.length > max ? s.slice(0, max) : s; }
async function logHistory({ cardId, userId, username, action, details = {} }) {
  try {
    await getSql()(
      'INSERT INTO card_history (card_id, user_id, username, action, details) VALUES ($1, $2, $3, $4, $5)',
      [cardId, userId || null, username || null, action, JSON.stringify(details)]
    );
  } catch (e) { console.warn('[history]', e.message); }
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  // Read schema.sql relative to repo root (Vercel bundles this file in the function)
  const candidates = [
    path.join(process.cwd(), 'electron', 'schema.sql'),
    path.join(__dirname, '..', 'electron', 'schema.sql'),
    path.join(__dirname, '..', '..', 'electron', 'schema.sql')
  ];
  let schema = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { schema = fs.readFileSync(c, 'utf-8'); break; }
  }
  if (schema) {
    for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) {
      try { await getSql()(stmt); } catch (e) { /* ignore individual stmt errors during cold-start */ }
    }
  }
  schemaReady = true;
}

const handlers = {
  'db:status': async () => ({ mode: 'neon' }),

  // Boards / Lists / Cards
  'boards:list': async () => getSql()('SELECT * FROM boards ORDER BY position, id'),
  'boards:create': async ({ title }) => (await getSql()('INSERT INTO boards (title, position) VALUES ($1, (SELECT COALESCE(MAX(position)+1,0) FROM boards)) RETURNING *', [title]))[0],
  'boards:rename': async ({ id, title }) => { await getSql()('UPDATE boards SET title=$1 WHERE id=$2', [title, id]); return true; },
  'boards:delete': async ({ id }) => { await getSql()('DELETE FROM boards WHERE id=$1', [id]); return true; },
  'lists:list': async ({ boardId }) => getSql()('SELECT * FROM lists WHERE board_id=$1 ORDER BY position, id', [boardId]),
  'lists:create': async ({ boardId, title }) => (await getSql()('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM lists WHERE board_id=$1)) RETURNING *', [boardId, title]))[0],
  'lists:rename': async ({ id, title }) => { await getSql()('UPDATE lists SET title=$1 WHERE id=$2', [title, id]); return true; },
  'lists:delete': async ({ id }) => { await getSql()('DELETE FROM lists WHERE id=$1', [id]); return true; },
  'lists:reorder': async ({ orderedIds }) => { for (let i = 0; i < orderedIds.length; i++) await getSql()('UPDATE lists SET position=$1 WHERE id=$2', [i, orderedIds[i]]); return true; },
  'cards:list': async ({ boardId }) => getSql()('SELECT c.* FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id=$1 ORDER BY c.position, c.id', [boardId]),
  'cards:create': async ({ listId, title, userId, username }) => {
    const r = (await getSql()('INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *', [listId, title]))[0];
    await logHistory({ cardId: r.id, userId, username, action: 'card.create', details: { title } });
    return r;
  },
  'cards:update': async (card) => {
    const old = await getSql()('SELECT * FROM cards WHERE id=$1', [card.id]);
    const before = old[0] || {};
    const clean = {
      title: card.title || 'Tanpa judul',
      description: card.description || '',
      parent_id: card.parent_id || null,
      priority: ['rendah','biasa','tinggi'].includes(card.priority) ? card.priority : 'biasa',
      start_at: card.start_at || null,
      due_at: card.due_at || null,
      color: card.color || null,
      completed: !!card.completed,
      reminder_minutes: [0,5,10,30].includes(Number(card.reminder_minutes)) ? Number(card.reminder_minutes) : 0,
      rule_kind: ['none','daily','weekly','monthly'].includes(card.rule_kind) ? card.rule_kind : 'none',
      rule_dow: Array.isArray(card.rule_dow) ? card.rule_dow.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      rule_dom: Number.isInteger(Number(card.rule_dom)) ? Number(card.rule_dom) : 0
    };
    let nextRun = null;
    if (clean.rule_kind !== 'none' && clean.due_at) {
      const nextDate = new Date(clean.due_at);
      if (clean.rule_kind === 'daily') nextDate.setDate(nextDate.getDate() + 1);
      else if (clean.rule_kind === 'weekly') {
        for (let i = 1; i <= 7; i++) {
          const c = new Date(clean.due_at);
          c.setDate(c.getDate() + i);
          if (clean.rule_dow.includes(c.getDay())) { nextDate.setTime(c.getTime()); break; }
        }
      } else if (clean.rule_kind === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
        const last = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
        nextDate.setDate(Math.min(clean.rule_dom || nextDate.getDate(), last));
      }
      nextRun = nextDate.toISOString();
    }
    await getSql()(
      `UPDATE cards SET title=$1, description=$2, parent_id=$3, priority=$4, start_at=$5, due_at=$6,
       color=$7, completed=$8, reminder_minutes=$9, updated_at=now(),
       rule_kind=$10, rule_dow=$11, rule_dom=$12, next_run_at=$13 WHERE id=$14`,
      [clean.title, clean.description, clean.parent_id, clean.priority, clean.start_at, clean.due_at,
       clean.color, clean.completed, clean.reminder_minutes,
       clean.rule_kind, clean.rule_dow, clean.rule_dom, nextRun, card.id]
    );
    const diff = {};
    for (const k of Object.keys(clean)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(clean[k])) diff[k] = { from: before[k], to: clean[k] };
    }
    if (Object.keys(diff).length) {
      await logHistory({ cardId: card.id, userId: card._userId, username: card._username, action: 'card.update', details: diff });
    }
    return true;
  },
  'cards:delete': async ({ id, userId, username }) => {
    await logHistory({ cardId: id, userId, username, action: 'card.delete', details: {} });
    await getSql()('DELETE FROM cards WHERE id=$1', [id]);
    return true;
  },
  'cards:move': async ({ cardId, toListId, orderedIds = [], userId, username }) => {
    const before = await getSql()('SELECT list_id FROM cards WHERE id=$1', [cardId]);
    await getSql()('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]);
    for (let i = 0; i < orderedIds.length; i++) await getSql()('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
    if (before[0] && Number(before[0].list_id) !== Number(toListId)) {
      await logHistory({ cardId, userId, username, action: 'card.move', details: { from_list: Number(before[0].list_id), to_list: Number(toListId) } });
    }
    return true;
  },
  'cards:upcoming': async () => getSql()('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at'),

  // Labels
  'labels:list': async ({ boardId }) => getSql()('SELECT * FROM labels WHERE board_id=$1 ORDER BY name', [boardId]),
  'labels:create': async ({ boardId, name, color }) => {
    const cleanName = cleanStr((name || '').trim() || 'Label', 40);
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#6366f1';
    const r = (await getSql()('INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (board_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *', [boardId, cleanName, cleanColor]))[0];
    return r;
  },
  'labels:rename': async ({ id, name }) => { await getSql()('UPDATE labels SET name=$1 WHERE id=$2', [cleanStr((name||'').trim(), 40), id]); return true; },
  'labels:delete': async ({ id }) => { await getSql()('DELETE FROM labels WHERE id=$1', [id]); return true; },

  'cards:labels': async ({ cardId }) => getSql()('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id = l.id WHERE cl.card_id=$1 ORDER BY l.name', [cardId]),
  'cards:labels:set': async ({ cardId, labelIds }) => {
    const ids = (Array.isArray(labelIds) ? labelIds : []).map(Number).filter(Number.isInteger);
    await getSql()('DELETE FROM card_labels WHERE card_id=$1', [cardId]);
    for (const lid of ids) await getSql()('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardId, lid]);
    return true;
  },

  // History
  'cards:history': async ({ cardId, limit }) => {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return await getSql()('SELECT * FROM card_history WHERE card_id=$1 ORDER BY created_at DESC LIMIT $2', [cardId, lim]);
  },

  // Recurring — serverless: a manual trigger; production should rely on Vercel Cron
  'recurring:run': async () => {
    const now = new Date().toISOString();
    const due = await getSql()("SELECT * FROM cards WHERE rule_kind <> 'none' AND next_run_at IS NOT NULL AND next_run_at <= $1", [now]);
    const spawned = [];
    for (const tpl of due) {
      // Compute next due by advancing one step from tpl.due_at
      let newDue = null;
      const cur = new Date(tpl.due_at);
      if (tpl.rule_kind === 'daily') { cur.setDate(cur.getDate() + 1); newDue = cur.toISOString(); }
      else if (tpl.rule_kind === 'weekly') {
        const dow = Array.isArray(tpl.rule_dow) ? tpl.rule_dow : [];
        for (let i = 1; i <= 7; i++) {
          const c = new Date(tpl.due_at); c.setDate(c.getDate() + i);
          if (dow.includes(c.getDay())) { newDue = c.toISOString(); break; }
        }
      } else if (tpl.rule_kind === 'monthly') {
        cur.setMonth(cur.getMonth() + 1);
        const dom = Number(tpl.rule_dom) || cur.getDate();
        const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        cur.setDate(Math.min(dom, last));
        newDue = cur.toISOString();
      }
      if (!newDue) continue;
      const r = (await getSql()(
        `INSERT INTO cards (list_id, parent_id, title, description, priority, start_at, due_at, color, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13) RETURNING *`,
        [tpl.list_id, tpl.parent_id, tpl.title, tpl.description || '', tpl.priority || 'biasa',
         null, newDue, tpl.color || null, tpl.reminder_minutes || 0, tpl.rule_kind,
         Array.isArray(tpl.rule_dow) ? tpl.rule_dow : [], Number(tpl.rule_dom) || 0, null]
      ))[0];
      // copy labels
      const labels = await getSql()('SELECT label_id FROM card_labels WHERE card_id=$1', [tpl.id]);
      for (const lr of labels) {
        await getSql()('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r.id, lr.label_id]);
      }
      // roll template forward
      const next = new Date(newDue);
      let nextNext = null;
      if (tpl.rule_kind === 'daily') { next.setDate(next.getDate() + 1); nextNext = next.toISOString(); }
      await getSql()('UPDATE cards SET next_run_at=$1 WHERE id=$2', [nextNext, tpl.id]);
      spawned.push(r);
    }
    return spawned;
  },

  // Export / Import
  'export:all': async () => {
    const [boards, lists, cards, labels, card_labels, users] = await Promise.all([
      getSql()('SELECT * FROM boards ORDER BY id'),
      getSql()('SELECT * FROM lists ORDER BY id'),
      getSql()('SELECT * FROM cards ORDER BY id'),
      getSql()('SELECT * FROM labels ORDER BY id'),
      getSql()('SELECT * FROM card_labels'),
      getSql()('SELECT id, username, role, approved, created_at FROM users ORDER BY id')
    ]);
    return { exported_at: new Date().toISOString(), version: 1, boards, lists, cards, labels, card_labels, users };
  },
  'import:all': async (payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('payload tidak valid');
    const { boards = [], lists = [], cards = [], labels = [], card_labels = [] } = payload;
    for (const b of boards) await getSql()(
      'INSERT INTO boards (id, title, position, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [b.id, b.title, b.position || 0, b.created_at || new Date().toISOString()]
    );
    for (const l of lists) await getSql()(
      'INSERT INTO lists (id, board_id, title, position, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [l.id, l.board_id, l.title, l.position || 0, l.created_at || new Date().toISOString()]
    );
    for (const c of cards) await getSql()(
      `INSERT INTO cards (id, list_id, parent_id, title, description, priority, start_at, due_at, color, completed, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at, updated_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, priority=EXCLUDED.priority, start_at=EXCLUDED.start_at, due_at=EXCLUDED.due_at, color=EXCLUDED.color, completed=EXCLUDED.completed, position=EXCLUDED.position, reminder_minutes=EXCLUDED.reminder_minutes, rule_kind=EXCLUDED.rule_kind, rule_dow=EXCLUDED.rule_dow, rule_dom=EXCLUDED.rule_dom, next_run_at=EXCLUDED.next_run_at, updated_at=now()`,
      [c.id, c.list_id, c.parent_id || null, c.title, c.description || '', c.priority || 'biasa',
       c.start_at || null, c.due_at || null, c.color || null, !!c.completed, c.position || 0,
       c.reminder_minutes || 0, c.rule_kind || 'none', Array.isArray(c.rule_dow) ? c.rule_dow : [],
       Number(c.rule_dom) || 0, c.next_run_at || null, new Date().toISOString(),
       c.created_at || new Date().toISOString()]
    );
    for (const lb of labels) await getSql()(
      'INSERT INTO labels (id, board_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color',
      [lb.id, lb.board_id, lb.name, lb.color, lb.created_at || new Date().toISOString()]
    );
    for (const cl of card_labels) await getSql()(
      'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cl.card_id, cl.label_id]
    );
    return { ok: true, counts: { boards: boards.length, lists: lists.length, cards: cards.length, labels: labels.length, card_labels: card_labels.length } };
  },

  // Auth & users
  'auth:login': async ({ username, password }) => {
    const hash = hashPw(password);
    const rows = await getSql()('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user) throw new Error('Username tidak ditemukan');
    if (user.password_hash !== hash) throw new Error('Password salah');
    if (!user.approved) throw new Error('Akun Anda belum disetujui oleh admin');
    return { id: user.id, username: user.username, role: user.role, approved: user.approved };
  },
  'auth:register': async ({ username, password }) => {
    const hash = hashPw(password);
    const exists = await getSql()('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await getSql()('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, 'user', false]);
    return r[0];
  },
  'users:list': async () => getSql()('SELECT id, username, role, approved, created_at FROM users ORDER BY id DESC'),
  'users:approve': async ({ id, approved }) => { await getSql()('UPDATE users SET approved=$1 WHERE id=$2', [approved, id]); return true; },
  'users:create': async ({ username, password, role }) => {
    const hash = hashPw(password);
    const exists = await getSql()('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await getSql()('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, role, true]);
    return r[0];
  },
  'users:delete': async ({ id }) => { await getSql()('DELETE FROM users WHERE id=$1', [id]); return true; }
};

module.exports = async (req, res) => {
  // CORS for any-origin (the app is a single-page client; no secrets exposed beyond sessionStorage)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  try {
    await ensureSchema();

    // Body parsing: Vercel may already parse JSON, but be safe.
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = body ? JSON.parse(body) : {}; } catch { body = {}; }
    }

    // Channel can come from query (?channel=foo) or path (api/foo) — support both.
    let channel = req.query && req.query.channel;
    if (!channel && req.url) {
      const m = req.url.match(/\/api\/([^/?]+)/);
      if (m) channel = decodeURIComponent(m[1]);
    }
    if (!channel) { res.status(400).send('Missing channel'); return; }

    const handler = handlers[channel];
    if (!handler) { res.status(404).send('Unknown API channel: ' + channel); return; }

    const result = await handler(body);
    res.status(200).json(result);
  } catch (e) {
    console.error('[api]', e);
    res.status(500).send(e.message || 'Internal Server Error');
  }
};
