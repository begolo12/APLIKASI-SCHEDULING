// FlowBoard DB layer — Neon Postgres only (single source of truth for Electron).
// Vercel / browser preview path uses vite-neon-api.js with the same SQL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { app } = require('electron');

// Load environment variables from multiple possible locations:
// 1. process.cwd() (development)
// 2. app.getPath('userData') (C:\Users\...\AppData\Roaming\flowboard)
// 3. next to the executable (portable style)
function loadEnv(userDataDir) {
  dotenv.config({ path: path.join(process.cwd(), '.env') });
  
  if (userDataDir && fs.existsSync(path.join(userDataDir, '.env'))) {
    dotenv.config({ path: path.join(userDataDir, '.env'), override: true });
  } else if (app) {
    try {
      const userDataEnv = path.join(app.getPath('userData'), '.env');
      if (fs.existsSync(userDataEnv)) {
        dotenv.config({ path: userDataEnv, override: true });
      }
    } catch (e) {}
  }
  
  if (process.execPath) {
    const exeEnv = path.join(path.dirname(process.execPath), '.env');
    if (fs.existsSync(exeEnv)) {
      dotenv.config({ path: exeEnv, override: true });
    }
  }
}

let sql = null;       // neon tagged-template client
let mode = 'neon';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function init(userDataDir) {
  loadEnv(userDataDir);
  const url = process.env.NEON_DATABASE_URL;
  if (!url || !url.startsWith('postgres')) {
    const targetPath = userDataDir || (app ? app.getPath('userData') : '');
    throw new Error(
      'Kredensial database (NEON_DATABASE_URL) tidak ditemukan!\n\n' +
      'Silakan buat file ".env" dan isi dengan connection string Neon Anda, lalu letakkan di:\n' +
      `-> ${path.join(targetPath, '.env')}\n\n` +
      'Format isi file .env:\n' +
      'NEON_DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require'
    );
  }
  const { neon } = require('@neondatabase/serverless');
  sql = neon(url);
  await migrate();
  await seedIfEmpty();
  mode = 'neon';
  console.log('[db] Connected to Neon Postgres');
  // userDataDir unused but kept for future local cache
  void userDataDir;
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
  const uRows = await sql('SELECT COUNT(*)::int AS c FROM users');
  if (uRows[0].c === 0) {
    const adminHash = hashPassword('admin123');
    await sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4)', ['admin', adminHash, 'admin', true]);
  }
}

function status() {
  return { mode, sqlReady: !!sql };
}

module.exports = {
  init,
  status,
  hashPassword,
  get mode() { return mode; },
  get sql() { return sql; }
};
