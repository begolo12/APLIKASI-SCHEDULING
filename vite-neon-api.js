import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
let sql;
let ready;
async function init() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL missing');
  sql = neon(process.env.NEON_DATABASE_URL);

  try {
    const check = await sql(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'card_history'
      )
    `);
    if (check[0] && check[0].exists) {
      return;
    }
  } catch (e) {
    console.warn('[api] Schema check failed, running migration:', e.message);
  }

  const schema = fs.readFileSync(path.join(process.cwd(), 'electron', 'schema.sql'), 'utf-8');
  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) await sql(stmt);
  const rows = await sql('SELECT COUNT(*)::int AS c FROM boards');
  if (rows[0].c === 0) {
    const b = await sql('INSERT INTO boards (title, position) VALUES ($1, 0) RETURNING id', ['Jadwal Saya']);
    for (const [i, title] of ['To Do', 'In Progress', 'Done'].entries()) await sql('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, $3)', [b[0].id, title, i]);
  }
  const uRows = await sql('SELECT COUNT(*)::int AS c FROM users');
  if (uRows[0].c === 0) {
    const adminHash = crypto.createHash('sha256').update('admin123').digest('hex');
    await sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4)', ['admin', adminHash, 'admin', true]);
  }
}
const ensureReady = () => ready || (ready = init());

// ---------------- helpers ----------------
function hashPw(p) { return crypto.createHash('sha256').update(p).digest('hex'); }
function cleanStr(v, max = 200) { if (v == null) return ''; const s = String(v); return s.length > max ? s.slice(0, max) : s; }
async function logHistory({ cardId, userId, username, action, details = {} }) {
  try {
    await sql(
      'INSERT INTO card_history (card_id, user_id, username, action, details) VALUES ($1, $2, $3, $4, $5)',
      [cardId, userId || null, username || null, action, JSON.stringify(details)]
    );
  } catch (e) { console.warn('[history]', e.message); }
}

const handlers = {
  'db:status': async () => ({ mode: 'neon' }),

  // Boards / Lists / Cards
  'boards:list': async () => sql('SELECT * FROM boards ORDER BY position, id'),
  'boards:create': async ({ title }) => (await sql('INSERT INTO boards (title, position) VALUES ($1, (SELECT COALESCE(MAX(position)+1,0) FROM boards)) RETURNING *', [title]))[0],
  'boards:rename': async ({ id, title }) => { await sql('UPDATE boards SET title=$1 WHERE id=$2', [title, id]); return true; },
  'boards:delete': async ({ id }) => { await sql('DELETE FROM boards WHERE id=$1', [id]); return true; },
  'lists:list': async ({ boardId }) => sql('SELECT * FROM lists WHERE board_id=$1 ORDER BY position, id', [boardId]),
  'lists:create': async ({ boardId, title }) => (await sql('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM lists WHERE board_id=$1)) RETURNING *', [boardId, title]))[0],
  'lists:rename': async ({ id, title }) => { await sql('UPDATE lists SET title=$1 WHERE id=$2', [title, id]); return true; },
  'lists:delete': async ({ id }) => { await sql('DELETE FROM lists WHERE id=$1', [id]); return true; },
  'lists:reorder': async ({ orderedIds }) => { for (let i = 0; i < orderedIds.length; i++) await sql('UPDATE lists SET position=$1 WHERE id=$2', [i, orderedIds[i]]); return true; },
  'cards:list': async ({ boardId }) => sql('SELECT c.* FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id=$1 ORDER BY c.position, c.id', [boardId]),
  'cards:create': async ({ listId, title, userId, username }) => {
    const r = (await sql('INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *', [listId, title]))[0];
    await logHistory({ cardId: r.id, userId, username, action: 'card.create', details: { title } });
    return r;
  },
  'cards:update': async (card) => {
    const old = await sql('SELECT * FROM cards WHERE id=$1', [card.id]);
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
    await sql(
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
    await sql('DELETE FROM cards WHERE id=$1', [id]);
    return true;
  },
  'cards:move': async ({ cardId, toListId, orderedIds = [], userId, username }) => {
    const before = await sql('SELECT list_id FROM cards WHERE id=$1', [cardId]);
    await sql('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]);
    for (let i = 0; i < orderedIds.length; i++) await sql('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
    if (before[0] && Number(before[0].list_id) !== Number(toListId)) {
      await logHistory({ cardId, userId, username, action: 'card.move', details: { from_list: Number(before[0].list_id), to_list: Number(toListId) } });
    }
    return true;
  },
  'cards:upcoming': async () => sql('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at'),

  // Labels
  'labels:list': async ({ boardId }) => sql('SELECT * FROM labels WHERE board_id=$1 ORDER BY name', [boardId]),
  'labels:create': async ({ boardId, name, color }) => {
    const cleanName = cleanStr((name || '').trim() || 'Label', 40);
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#6366f1';
    const r = (await sql('INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (board_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *', [boardId, cleanName, cleanColor]))[0];
    return r;
  },
  'labels:rename': async ({ id, name }) => { await sql('UPDATE labels SET name=$1 WHERE id=$2', [cleanStr((name||'').trim(), 40), id]); return true; },
  'labels:delete': async ({ id }) => { await sql('DELETE FROM labels WHERE id=$1', [id]); return true; },

  // Export / Import
  'export:all': async () => {
    const [boards, lists, cards, labels, card_labels, users] = await Promise.all([
      sql('SELECT * FROM boards ORDER BY id'),
      sql('SELECT * FROM lists ORDER BY id'),
      sql('SELECT * FROM cards ORDER BY id'),
      sql('SELECT * FROM labels ORDER BY id'),
      sql('SELECT * FROM card_labels'),
      sql('SELECT id, username, role, approved, created_at FROM users ORDER BY id')
    ]);
    return { exported_at: new Date().toISOString(), version: 1, boards, lists, cards, labels, card_labels, users };
  },
  'import:all': async (payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('payload tidak valid');
    const { boards = [], lists = [], cards = [], labels = [], card_labels = [], users = [] } = payload;
    // Idempotent-ish: skip users (passwords not exported), upsert the rest by id
    for (const b of boards) await sql(
      'INSERT INTO boards (id, title, position, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [b.id, b.title, b.position || 0, b.created_at || new Date().toISOString()]
    );
    for (const l of lists) await sql(
      'INSERT INTO lists (id, board_id, title, position, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [l.id, l.board_id, l.title, l.position || 0, l.created_at || new Date().toISOString()]
    );
    for (const c of cards) await sql(
      `INSERT INTO cards (id, list_id, parent_id, title, description, priority, start_at, due_at, color, completed, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at, updated_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, priority=EXCLUDED.priority, start_at=EXCLUDED.start_at, due_at=EXCLUDED.due_at, color=EXCLUDED.color, completed=EXCLUDED.completed, position=EXCLUDED.position, reminder_minutes=EXCLUDED.reminder_minutes, rule_kind=EXCLUDED.rule_kind, rule_dow=EXCLUDED.rule_dow, rule_dom=EXCLUDED.rule_dom, next_run_at=EXCLUDED.next_run_at, updated_at=now()`,
      [c.id, c.list_id, c.parent_id || null, c.title, c.description || '', c.priority || 'biasa',
       c.start_at || null, c.due_at || null, c.color || null, !!c.completed, c.position || 0,
       c.reminder_minutes || 0, c.rule_kind || 'none', Array.isArray(c.rule_dow) ? c.rule_dow : [],
       Number(c.rule_dom) || 0, c.next_run_at || null, new Date().toISOString(),
       c.created_at || new Date().toISOString()]
    );
    for (const lb of labels) await sql(
      'INSERT INTO labels (id, board_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color',
      [lb.id, lb.board_id, lb.name, lb.color, lb.created_at || new Date().toISOString()]
    );
    for (const cl of card_labels) await sql(
      'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cl.card_id, cl.label_id]
    );
    return { ok: true, counts: { boards: boards.length, lists: lists.length, cards: cards.length, labels: labels.length, card_labels: card_labels.length } };
  },

  // Card-label associations
  'cards:labels': async ({ cardId }) => sql('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id = l.id WHERE cl.card_id=$1 ORDER BY l.name', [cardId]),
  'boards:cards:labels': async ({ boardId }) => sql('SELECT cl.card_id, l.* FROM labels l JOIN card_labels cl ON cl.label_id = l.id WHERE l.board_id=$1 ORDER BY l.name', [boardId]),
  'cards:labels:set': async ({ cardId, labelIds }) => {
    const ids = (Array.isArray(labelIds) ? labelIds : []).map(Number).filter(Number.isInteger);
    await sql('DELETE FROM card_labels WHERE card_id=$1', [cardId]);
    for (const lid of ids) await sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardId, lid]);
    return true;
  },

  // History
  'cards:history': async ({ cardId, limit }) => {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return await sql('SELECT * FROM card_history WHERE card_id=$1 ORDER BY created_at DESC LIMIT $2', [cardId, lim]);
  },

  // Recurring (manual trigger; in serverless usually a cron job)
  'recurring:run': async () => [],

  // Auth & users
  'auth:login': async ({ username, password }) => {
    const hash = hashPw(password);
    const rows = await sql('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user) throw new Error('Username tidak ditemukan');
    if (user.password_hash !== hash) throw new Error('Password salah');
    if (!user.approved) throw new Error('Akun Anda belum disetujui oleh admin');
    return { id: user.id, username: user.username, role: user.role, approved: user.approved };
  },
  'auth:register': async ({ username, password }) => {
    const hash = hashPw(password);
    const exists = await sql('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, 'user', false]);
    return r[0];
  },
  'users:list': async () => sql('SELECT id, username, role, approved, created_at FROM users ORDER BY id DESC'),
  'users:approve': async ({ id, approved }) => { await sql('UPDATE users SET approved=$1 WHERE id=$2', [approved, id]); return true; },
  'users:create': async ({ username, password, role }) => {
    const hash = hashPw(password);
    const exists = await sql('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, role, true]);
    return r[0];
  },
  'users:delete': async ({ id }) => { await sql('DELETE FROM users WHERE id=$1', [id]); return true; }
};

export default function neonApiPlugin() {
  return { name: 'flowboard-neon-api', configureServer(server) { server.middlewares.use('/api', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      await ensureReady();
      const channel = decodeURIComponent(req.url.slice(1));
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', async () => {
        try {
          const handler = handlers[channel];
          if (!handler) throw new Error(`Unknown API channel: ${channel}`);
          const result = await handler(raw ? JSON.parse(raw) : {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (e) { res.statusCode = 500; res.end(e.message); }
      });
    } catch (e) { res.statusCode = 500; res.end(e.message); }
  }); } };
}
