// IPC handlers for FlowBoard. Neon-only (no local JSON fallback).
// Each operation records history + handles recurring card generation.
const { app } = require('electron');
const db = require('./db');

// ---------------- Validators ----------------
function id(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} tidak valid`);
  return n;
}
function title(value, fallback = 'Tanpa judul') {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || fallback;
}
function validDate(value, name) {
  if (value == null || value === '') return null;
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`${name} tidak valid`);
  return value;
}
function reminder(value) {
  const n = Number(value);
  return [0, 5, 10, 30].includes(n) ? n : 0;
}
function cleanStr(value, max = 200) {
  if (value == null) return '';
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

// ---------------- History helper ----------------
async function logHistory({ cardId, userId, username, action, details = {} }) {
  try {
    await db.sql(
      'INSERT INTO card_history (card_id, user_id, username, action, details) VALUES ($1, $2, $3, $4, $5)',
      [cardId, userId || null, username || null, action, JSON.stringify(details)]
    );
  } catch (e) {
    console.warn('[history] log failed:', e.message);
  }
}

// ---------------- Recurring engine ----------------
// Compute next_run_at from current due_at and rule.
function computeNextRun(card) {
  if (!card.rule_kind || card.rule_kind === 'none') return null;
  const base = card.due_at ? new Date(card.due_at) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base);

  if (card.rule_kind === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (card.rule_kind === 'weekly') {
    const dow = Array.isArray(card.rule_dow) ? card.rule_dow : [];
    if (!dow.length) {
      next.setDate(next.getDate() + 7);
    } else {
      // Pick the next matching day-of-week (1..7 days ahead)
      for (let i = 1; i <= 7; i++) {
        const candidate = new Date(base);
        candidate.setDate(candidate.getDate() + i);
        if (dow.includes(candidate.getDay())) {
          next.setTime(candidate.getTime());
          break;
        }
      }
    }
  } else if (card.rule_kind === 'monthly') {
    const dom = Number(card.rule_dom) || base.getDate();
    next.setMonth(next.getMonth() + 1);
    // Clamp to last day of month if dom > days in next month
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(dom, last));
  } else {
    return null;
  }
  return next.toISOString();
}

// Generate next occurrence from a template card (returns new card object, leaves template intact).
async function spawnNextOccurrence(template) {
  if (!template.due_at) return null;
  const newDue = new Date(template.due_at);
  newDue.setDate(newDue.getDate() + 1); // initial next day; will be overridden below

  // Compute based on rule type
  let startISO = null, dueISO = null;
  if (template.rule_kind === 'daily') {
    newDue.setDate(new Date(template.due_at).getDate() + 1);
    dueISO = newDue.toISOString();
    if (template.start_at) {
      const s = new Date(template.start_at);
      s.setDate(s.getDate() + 1);
      startISO = s.toISOString();
    }
  } else if (template.rule_kind === 'weekly') {
    const dow = Array.isArray(template.rule_dow) ? template.rule_dow : [];
    if (!dow.length) return null;
    const cur = new Date(template.due_at);
    for (let i = 1; i <= 7; i++) {
      const c = new Date(cur);
      c.setDate(c.getDate() + i);
      if (dow.includes(c.getDay())) {
        dueISO = c.toISOString();
        if (template.start_at) {
          const s = new Date(template.start_at);
          s.setDate(s.getDate() + (i));
          startISO = s.toISOString();
        }
        break;
      }
    }
  } else if (template.rule_kind === 'monthly') {
    const cur = new Date(template.due_at);
    const next = new Date(cur);
    next.setMonth(next.getMonth() + 1);
    const dom = Number(template.rule_dom) || cur.getDate();
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(dom, last));
    dueISO = next.toISOString();
    if (template.start_at) {
      const s = new Date(template.start_at);
      s.setMonth(s.getMonth() + 1);
      s.setDate(Math.min(dom, last));
      startISO = s.toISOString();
    }
  }

  if (!dueISO) return null;

  const r = await db.sql(
    'INSERT INTO cards (list_id, parent_id, title, description, priority, start_at, due_at, color, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1),$9,$10,$11,$12,$13) RETURNING *',
    [
      template.list_id, template.parent_id, template.title, template.description || '',
      template.priority || 'biasa', startISO, dueISO, template.color || null,
      template.reminder_minutes || 0, template.rule_kind,
      Array.isArray(template.rule_dow) ? template.rule_dow : [],
      Number(template.rule_dom) || 0, computeNextRun({ ...template, due_at: dueISO })
    ]
  );
  // Copy labels from template
  if (r[0] && r[0].id) {
    const labels = await db.sql('SELECT label_id FROM card_labels WHERE card_id=$1', [template.id]);
    for (const lr of labels) {
      await db.sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r[0].id, lr.label_id]);
    }
  }
  return r[0];
}

// Sweep: process any templates whose next_run_at is in the past, generate a new occurrence,
// and roll next_run_at forward.
async function processRecurring() {
  if (db.mode !== 'neon') return [];
  const now = new Date().toISOString();
  const due = await db.sql(
    "SELECT * FROM cards WHERE rule_kind <> 'none' AND next_run_at IS NOT NULL AND next_run_at <= $1",
    [now]
  );
  const spawned = [];
  for (const tpl of due) {
    const child = await spawnNextOccurrence(tpl);
    if (child) {
      spawned.push(child);
      await logHistory({
        cardId: tpl.id,
        action: 'recurring.spawn',
        details: { new_card_id: Number(child.id), child_title: child.title }
      });
    } else {
      // Could not spawn — push next_run_at forward 1 day to avoid spam loop
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + 1);
      await db.sql('UPDATE cards SET next_run_at=$1 WHERE id=$2', [fallback.toISOString(), tpl.id]);
    }
  }
  return spawned;
}

// ---------------- IPC registration ----------------
async function registerIpcHandlers(ipcMain, getWindow) {
  await db.init(app.getPath('userData'));

  // Run recurring sweep once at boot
  processRecurring().catch(e => console.warn('[recurring] boot sweep failed:', e.message));
  // Then every 5 minutes
  setInterval(() => {
    processRecurring().catch(e => console.warn('[recurring] sweep failed:', e.message));
  }, 5 * 60 * 1000);

  ipcMain.handle('db:status', () => db.status());
  ipcMain.handle('recurring:run', async () => processRecurring());

  // ---------------- BOARDS ----------------
  ipcMain.handle('boards:list', async () => {
    return await db.sql('SELECT * FROM boards ORDER BY position, id');
  });

  ipcMain.handle('lists:list', async (_e, { boardId }) => {
    return await db.sql('SELECT * FROM lists WHERE board_id=$1 ORDER BY position, id', [boardId]);
  });

  ipcMain.handle('cards:list', async (_e, { boardId }) => {
    return await db.sql(
      'SELECT c.* FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id=$1 ORDER BY c.position, c.id',
      [boardId]
    );
  });

  ipcMain.handle('boards:create', async (_e, { title: boardTitle }) => {
    const cleanTitle = title(boardTitle, 'Papan baru');
    const r = await db.sql(
      'INSERT INTO boards (title, position) VALUES ($1, (SELECT COALESCE(MAX(position)+1,0) FROM boards)) RETURNING *',
      [cleanTitle]
    );
    return r[0];
  });

  ipcMain.handle('boards:rename', async (_e, { id, title }) => {
    await db.sql('UPDATE boards SET title=$1 WHERE id=$2', [title, id]);
    return true;
  });

  ipcMain.handle('boards:delete', async (_e, { id }) => {
    await db.sql('DELETE FROM boards WHERE id=$1', [id]);
    return true;
  });

  // ---------------- LISTS ----------------
  ipcMain.handle('lists:create', async (_e, { boardId, title }) => {
    const r = await db.sql(
      'INSERT INTO lists (board_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM lists WHERE board_id=$1)) RETURNING *',
      [boardId, title]
    );
    return r[0];
  });

  ipcMain.handle('lists:rename', async (_e, { id, title }) => {
    await db.sql('UPDATE lists SET title=$1 WHERE id=$2', [title, id]);
    return true;
  });

  ipcMain.handle('lists:delete', async (_e, { id }) => {
    await db.sql('DELETE FROM lists WHERE id=$1', [id]);
    return true;
  });

  ipcMain.handle('lists:reorder', async (_e, { orderedIds }) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.sql('UPDATE lists SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    return true;
  });

  // ---------------- CARDS ----------------
  ipcMain.handle('cards:create', async (_e, { listId, title: cardTitle, userId, username }) => {
    const cleanListId = id(listId, 'listId');
    const cleanTitle = title(cardTitle, 'Kartu baru');
    const r = await db.sql(
      'INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *',
      [cleanListId, cleanTitle]
    );
    await logHistory({ cardId: r[0].id, userId, username, action: 'card.create', details: { title: cleanTitle } });
    return r[0];
  });

  ipcMain.handle('cards:update', async (_e, card) => {
    const clean = {
      id: id(card.id),
      title: title(card.title),
      description: typeof card.description === 'string' ? card.description : '',
      parent_id: card.parent_id ? id(card.parent_id, 'parent_id') : null,
      priority: ['rendah', 'biasa', 'tinggi'].includes(card.priority) ? card.priority : 'biasa',
      start_at: validDate(card.start_at, 'Tanggal mulai'),
      due_at: validDate(card.due_at, 'Tenggat waktu'),
      reminder_minutes: reminder(card.reminder_minutes),
      color: typeof card.color === 'string' ? card.color : null,
      completed: !!card.completed,
      rule_kind: ['none', 'daily', 'weekly', 'monthly'].includes(card.rule_kind) ? card.rule_kind : 'none',
      rule_dow: Array.isArray(card.rule_dow) ? card.rule_dow.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      rule_dom: Number.isInteger(Number(card.rule_dom)) ? Number(card.rule_dom) : 0
    };
    // Compute next_run_at when rule active
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

    // Load old to compute diff for history
    const old = await db.sql('SELECT * FROM cards WHERE id=$1', [clean.id]);
    const before = old[0] || {};

    await db.sql(
      `UPDATE cards SET title=$1, description=$2, parent_id=$3, priority=$4, start_at=$5, due_at=$6,
       color=$7, completed=$8, reminder_minutes=$9, updated_at=now(), sync_state='dirty',
       rule_kind=$10, rule_dow=$11, rule_dom=$12, next_run_at=$13 WHERE id=$14`,
      [clean.title, clean.description, clean.parent_id, clean.priority, clean.start_at, clean.due_at,
       clean.color, clean.completed, clean.reminder_minutes,
       clean.rule_kind, clean.rule_dow, clean.rule_dom, nextRun, clean.id]
    );

    // History: log changed fields
    const diff = {};
    for (const k of Object.keys(clean)) {
      if (k === 'id') continue;
      const a = before[k];
      const b = clean[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = { from: a, to: b };
    }
    if (Object.keys(diff).length) {
      await logHistory({
        cardId: clean.id,
        userId: card._userId,
        username: card._username,
        action: 'card.update',
        details: diff
      });
    }
    return true;
  });

  ipcMain.handle('cards:delete', async (_e, { id, userId, username }) => {
    await logHistory({ cardId: id, userId, username, action: 'card.delete', details: {} });
    await db.sql('DELETE FROM cards WHERE id=$1', [id]);
    return true;
  });

  ipcMain.handle('cards:move', async (_e, { cardId, toListId, orderedIds, userId, username }) => {
    const before = await db.sql('SELECT list_id FROM cards WHERE id=$1', [cardId]);
    await db.sql('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]);
    for (let i = 0; i < orderedIds.length; i++) {
      await db.sql('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    if (before[0] && Number(before[0].list_id) !== Number(toListId)) {
      await logHistory({
        cardId,
        userId,
        username,
        action: 'card.move',
        details: { from_list: Number(before[0].list_id), to_list: Number(toListId) }
      });
    }
    return true;
  });

  // ---------------- LABELS ----------------
  ipcMain.handle('labels:list', async (_e, { boardId }) => {
    return await db.sql('SELECT * FROM labels WHERE board_id=$1 ORDER BY name', [boardId]);
  });

  ipcMain.handle('labels:create', async (_e, { boardId, name, color }) => {
    const cleanName = cleanStr((name || '').trim() || 'Label', 40);
    const cleanColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
    const r = await db.sql(
      'INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (board_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *',
      [boardId, cleanName, cleanColor]
    );
    return r[0];
  });

  ipcMain.handle('labels:rename', async (_e, { id, name }) => {
    const cleanName = cleanStr((name || '').trim(), 40);
    await db.sql('UPDATE labels SET name=$1 WHERE id=$2', [cleanName, id]);
    return true;
  });

  ipcMain.handle('labels:delete', async (_e, { id }) => {
    await db.sql('DELETE FROM labels WHERE id=$1', [id]);
    return true;
  });

  // ---------------- EXPORT / IMPORT ----------------
  ipcMain.handle('export:all', async () => {
    const [boards, lists, cards, labels, card_labels, users] = await Promise.all([
      db.sql('SELECT * FROM boards ORDER BY id'),
      db.sql('SELECT * FROM lists ORDER BY id'),
      db.sql('SELECT * FROM cards ORDER BY id'),
      db.sql('SELECT * FROM labels ORDER BY id'),
      db.sql('SELECT * FROM card_labels'),
      db.sql('SELECT id, username, role, approved, created_at FROM users ORDER BY id')
    ]);
    return { exported_at: new Date().toISOString(), version: 1, boards, lists, cards, labels, card_labels, users };
  });

  ipcMain.handle('import:all', async (_e, payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('payload tidak valid');
    const { boards = [], lists = [], cards = [], labels = [], card_labels = [] } = payload;
    for (const b of boards) await db.sql(
      'INSERT INTO boards (id, title, position, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [b.id, b.title, b.position || 0, b.created_at || new Date().toISOString()]
    );
    for (const l of lists) await db.sql(
      'INSERT INTO lists (id, board_id, title, position, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, position=EXCLUDED.position',
      [l.id, l.board_id, l.title, l.position || 0, l.created_at || new Date().toISOString()]
    );
    for (const c of cards) await db.sql(
      `INSERT INTO cards (id, list_id, parent_id, title, description, priority, start_at, due_at, color, completed, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at, updated_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, priority=EXCLUDED.priority, start_at=EXCLUDED.start_at, due_at=EXCLUDED.due_at, color=EXCLUDED.color, completed=EXCLUDED.completed, position=EXCLUDED.position, reminder_minutes=EXCLUDED.reminder_minutes, rule_kind=EXCLUDED.rule_kind, rule_dow=EXCLUDED.rule_dow, rule_dom=EXCLUDED.rule_dom, next_run_at=EXCLUDED.next_run_at, updated_at=now()`,
      [c.id, c.list_id, c.parent_id || null, c.title, c.description || '', c.priority || 'biasa',
       c.start_at || null, c.due_at || null, c.color || null, !!c.completed, c.position || 0,
       c.reminder_minutes || 0, c.rule_kind || 'none', Array.isArray(c.rule_dow) ? c.rule_dow : [],
       Number(c.rule_dom) || 0, c.next_run_at || null, new Date().toISOString(),
       c.created_at || new Date().toISOString()]
    );
    for (const lb of labels) await db.sql(
      'INSERT INTO labels (id, board_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color',
      [lb.id, lb.board_id, lb.name, lb.color, lb.created_at || new Date().toISOString()]
    );
    for (const cl of card_labels) await db.sql(
      'INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cl.card_id, cl.label_id]
    );
    return { ok: true, counts: { boards: boards.length, lists: lists.length, cards: cards.length, labels: labels.length, card_labels: card_labels.length } };
  });

  // ---------------- CARD-LABEL ASSOCIATIONS ----------------
  ipcMain.handle('cards:labels', async (_e, { cardId }) => {
    return await db.sql(
      'SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id = l.id WHERE cl.card_id=$1 ORDER BY l.name',
      [cardId]
    );
  });

  ipcMain.handle('boards:cards:labels', async (_e, { boardId }) => {
    return await db.sql(
      `SELECT cl.card_id, l.* FROM labels l 
       JOIN card_labels cl ON cl.label_id = l.id 
       WHERE l.board_id = $1 
       ORDER BY l.name`,
      [boardId]
    );
  });

  ipcMain.handle('cards:labels:set', async (_e, { cardId, labelIds }) => {
    const ids = (Array.isArray(labelIds) ? labelIds : []).map(Number).filter(Number.isInteger);
    await db.sql('DELETE FROM card_labels WHERE card_id=$1', [cardId]);
    for (const lid of ids) {
      await db.sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardId, lid]);
    }
    return true;
  });

  // ---------------- HISTORY ----------------
  ipcMain.handle('cards:history', async (_e, { cardId, limit }) => {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return await db.sql(
      'SELECT * FROM card_history WHERE card_id=$1 ORDER BY created_at DESC LIMIT $2',
      [cardId, lim]
    );
  });

  // ---------------- AUTENTIKASI & USER MANAGEMENT ----------------
  ipcMain.handle('auth:login', async (_e, { username, password }) => {
    const hash = db.hashPassword(password);
    const rows = await db.sql('SELECT * FROM users WHERE username=$1', [username]);
    const user = rows[0];
    if (!user) throw new Error('Username tidak ditemukan');
    if (user.password_hash !== hash) throw new Error('Password salah');
    if (!user.approved) throw new Error('Akun Anda belum disetujui oleh admin');
    return { id: user.id, username: user.username, role: user.role, approved: user.approved };
  });

  ipcMain.handle('auth:register', async (_e, { username, password }) => {
    const hash = db.hashPassword(password);
    const exists = await db.sql('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await db.sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, 'user', false]);
    return r[0];
  });

  ipcMain.handle('users:list', async () => {
    return await db.sql('SELECT id, username, role, approved, created_at FROM users ORDER BY id DESC');
  });

  ipcMain.handle('users:approve', async (_e, { id, approved }) => {
    await db.sql('UPDATE users SET approved=$1 WHERE id=$2', [approved, id]);
    return true;
  });

  ipcMain.handle('users:create', async (_e, { username, password, role }) => {
    const hash = db.hashPassword(password);
    const exists = await db.sql('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.length) throw new Error('Username sudah digunakan');
    const r = await db.sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, role, true]);
    return r[0];
  });

  ipcMain.handle('users:delete', async (_e, { id }) => {
    await db.sql('DELETE FROM users WHERE id=$1', [id]);
    return true;
  });

  // ---------------- SCHEDULING ----------------
  ipcMain.handle('cards:upcoming', async () => {
    return await db.sql('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at');
  });
}

module.exports = { registerIpcHandlers };
