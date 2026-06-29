// FlowBoard data layer.
// Uses Neon Postgres when NEON_DATABASE_URL is set; otherwise falls back to a
// local JSON file so the app runs immediately without a database.
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let mode = 'local'; // 'neon' | 'local'
let sql = null;     // neon tagged-template client
let localPath = null;
let local = null;   // in-memory mirror of local JSON

// ---------- Local JSON store ----------
function defaultData() {
  const now = new Date().toISOString();
  return {
    seq: 7,
    boards: [{ id: 1, title: 'Jadwal Saya', position: 0, created_at: now }],
    lists: [
      { id: 2, board_id: 1, title: 'To Do', position: 0, created_at: now },
      { id: 3, board_id: 1, title: 'In Progress', position: 1, created_at: now },
      { id: 4, board_id: 1, title: 'Done', position: 2, created_at: now }
    ],
    cards: [
      { id: 5, list_id: 2, title: 'Selamat datang di FlowBoard 👋', description: 'Klik kartu untuk mengedit. Seret kartu antar kolom.', parent_id: null, priority: 'biasa', start_at: null, due_at: null, color: '#6366f1', completed: false, position: 0, created_at: now },
      { id: 6, list_id: 2, title: 'Coba atur tenggat waktu', description: 'Buka kartu, set due date & lihat di Kalender.', parent_id: null, priority: 'biasa', start_at: null, due_at: null, color: '#ec4899', completed: false, position: 1, created_at: now }
    ]
  };
}

function loadLocal() {
  try {
    if (fs.existsSync(localPath)) {
      local = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    } else {
      local = defaultData();
      saveLocal();
    }
  } catch (e) {
    console.warn('Local store load failed, recreating:', e.message);
    local = defaultData();
    saveLocal();
  }
}

function saveLocal() {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, JSON.stringify(local, null, 2));
  } catch (e) {
    console.error('Local store save failed:', e.message);
  }
}

function nextId() {
  local.seq += 1;
  return local.seq;
}

// ---------- Init ----------
async function init(userDataDir) {
  localPath = path.join(userDataDir, 'flowboard-data.json');
  const url = process.env.NEON_DATABASE_URL;

  if (url && url.startsWith('postgres')) {
    try {
      const { neon } = require('@neondatabase/serverless');
      sql = neon(url);
      await migrate();
      await seedIfEmpty();
      mode = 'neon';
      console.log('[db] Connected to Neon Postgres');
      return;
    } catch (e) {
      console.error('[db] Neon connection failed, using local store:', e.message);
    }
  }
  mode = 'local';
  loadLocal();
  console.log('[db] Using local JSON store at', localPath);
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  // neon() can't run multiple statements in one call; split on semicolons.
  const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await sql(stmt);
  }
}

async function seedIfEmpty() {
  const rows = await sql('SELECT COUNT(*)::int AS c FROM boards');
  if (rows[0].c === 0) {
    const b = await sql('INSERT INTO boards (title, position) VALUES ($1, 0) RETURNING id', ['Jadwal Saya']);
    const boardId = b[0].id;
    const titles = ['To Do', 'In Progress', 'Done'];
    for (let i = 0; i < titles.length; i++) {
      await sql('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, $3)', [boardId, titles[i], i]);
    }
  }
}

function status() {
  return { mode };
}

module.exports = {
  init,
  status,
  get mode() { return mode; },
  get sql() { return sql; },
  get local() { return local; },
  saveLocal,
  nextId
};
