const { neon } = require('@neondatabase/serverless');

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

const handlers = {
  'db:status': async () => ({ mode: 'neon' }),
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
  'cards:create': async ({ listId, title }) => (await getSql()('INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *', [listId, title]))[0],
  'cards:update': async (card) => { await getSql()('UPDATE cards SET title=$1, description=$2, parent_id=$3, priority=$4, start_at=$5, due_at=$6, color=$7, completed=$8 WHERE id=$9', [card.title, card.description || '', card.parent_id || null, card.priority || 'biasa', card.start_at || null, card.due_at || null, card.color || null, !!card.completed, card.id]); return true; },
  'cards:delete': async ({ id }) => { await getSql()('DELETE FROM cards WHERE id=$1', [id]); return true; },
  'cards:move': async ({ cardId, toListId, orderedIds = [] }) => { await getSql()('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]); for (let i = 0; i < orderedIds.length; i++) await getSql()('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]); return true; },
  'cards:upcoming': async () => getSql()('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at')
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  try {
    const { channel } = req.query;
    const handler = handlers[channel];
    if (!handler) {
      res.status(404).send('Unknown API channel: ' + channel);
      return;
    }
    const payload = req.body || {};
    const result = await handler(payload);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).send(e.message);
  }
};
