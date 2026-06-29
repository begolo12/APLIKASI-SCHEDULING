import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();
let sql;
let ready;
async function init() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL missing');
  sql = neon(process.env.NEON_DATABASE_URL);
  const schema = fs.readFileSync(path.join(process.cwd(), 'electron', 'schema.sql'), 'utf-8');
  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) await sql(stmt);
  const rows = await sql('SELECT COUNT(*)::int AS c FROM boards');
  if (rows[0].c === 0) {
    const b = await sql('INSERT INTO boards (title, position) VALUES ($1, 0) RETURNING id', ['Jadwal Saya']);
    for (const [i, title] of ['To Do', 'In Progress', 'Done'].entries()) await sql('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, $3)', [b[0].id, title, i]);
  }
}
const ensureReady = () => ready || (ready = init());
const handlers = {
  'db:status': async () => ({ mode: 'neon' }),
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
  'cards:create': async ({ listId, title }) => (await sql('INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *', [listId, title]))[0],
  'cards:update': async (card) => { await sql('UPDATE cards SET title=$1, description=$2, parent_id=$3, priority=$4, start_at=$5, due_at=$6, color=$7, completed=$8 WHERE id=$9', [card.title, card.description || '', card.parent_id || null, card.priority || 'biasa', card.start_at || null, card.due_at || null, card.color || null, !!card.completed, card.id]); return true; },
  'cards:delete': async ({ id }) => { await sql('DELETE FROM cards WHERE id=$1', [id]); return true; },
  'cards:move': async ({ cardId, toListId, orderedIds = [] }) => { await sql('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]); for (let i = 0; i < orderedIds.length; i++) await sql('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]); return true; },
  'cards:upcoming': async () => sql('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at')
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
