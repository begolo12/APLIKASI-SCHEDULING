// IPC handlers for FlowBoard. Each operation works against either Neon or the
// local JSON store, depending on db.mode.
const { app } = require('electron');
const db = require('./db');

async function registerIpcHandlers(ipcMain, getWindow) {
  await db.init(app.getPath('userData'));

  ipcMain.handle('db:status', () => db.status());

  // ---------------- BOARDS ----------------
  ipcMain.handle('boards:list', async () => {
    if (db.mode === 'neon') {
      return await db.sql('SELECT * FROM boards ORDER BY position, id');
    }
    return [...db.local.boards].sort((a, b) => a.position - b.position || a.id - b.id);
  });

  // Fetch lists for a board
  ipcMain.handle('lists:list', async (_e, { boardId }) => {
    if (db.mode === 'neon') {
      return await db.sql('SELECT * FROM lists WHERE board_id=$1 ORDER BY position, id', [boardId]);
    }
    return db.local.lists.filter(l => l.board_id === boardId).sort((a, b) => a.position - b.position || a.id - b.id);
  });

  // Fetch cards for a board (joined through its lists)
  ipcMain.handle('cards:list', async (_e, { boardId }) => {
    if (db.mode === 'neon') {
      return await db.sql(
        'SELECT c.* FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id=$1 ORDER BY c.position, c.id',
        [boardId]
      );
    }
    const listIds = db.local.lists.filter(l => l.board_id === boardId).map(l => l.id);
    return db.local.cards.filter(c => listIds.includes(c.list_id)).sort((a, b) => a.position - b.position || a.id - b.id);
  });

  ipcMain.handle('boards:create', async (_e, { title }) => {
    if (db.mode === 'neon') {
      const r = await db.sql(
        'INSERT INTO boards (title, position) VALUES ($1, (SELECT COALESCE(MAX(position)+1,0) FROM boards)) RETURNING *',
        [title]
      );
      return r[0];
    }
    const board = { id: db.nextId(), title, position: db.local.boards.length, created_at: new Date().toISOString() };
    db.local.boards.push(board);
    db.saveLocal();
    return board;
  });

  ipcMain.handle('boards:rename', async (_e, { id, title }) => {
    if (db.mode === 'neon') {
      await db.sql('UPDATE boards SET title=$1 WHERE id=$2', [title, id]);
    } else {
      const b = db.local.boards.find(x => x.id === id);
      if (b) { b.title = title; db.saveLocal(); }
    }
    return true;
  });

  ipcMain.handle('boards:delete', async (_e, { id }) => {
    if (db.mode === 'neon') {
      await db.sql('DELETE FROM boards WHERE id=$1', [id]);
    } else {
      const listIds = db.local.lists.filter(l => l.board_id === id).map(l => l.id);
      db.local.cards = db.local.cards.filter(c => !listIds.includes(c.list_id));
      db.local.lists = db.local.lists.filter(l => l.board_id !== id);
      db.local.boards = db.local.boards.filter(b => b.id !== id);
      db.saveLocal();
    }
    return true;
  });

  // ---------------- LISTS ----------------
  ipcMain.handle('lists:create', async (_e, { boardId, title }) => {
    if (db.mode === 'neon') {
      const r = await db.sql(
        'INSERT INTO lists (board_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM lists WHERE board_id=$1)) RETURNING *',
        [boardId, title]
      );
      return r[0];
    }
    const pos = db.local.lists.filter(l => l.board_id === boardId).length;
    const list = { id: db.nextId(), board_id: boardId, title, position: pos, created_at: new Date().toISOString() };
    db.local.lists.push(list);
    db.saveLocal();
    return list;
  });

  ipcMain.handle('lists:rename', async (_e, { id, title }) => {
    if (db.mode === 'neon') {
      await db.sql('UPDATE lists SET title=$1 WHERE id=$2', [title, id]);
    } else {
      const l = db.local.lists.find(x => x.id === id);
      if (l) { l.title = title; db.saveLocal(); }
    }
    return true;
  });

  ipcMain.handle('lists:delete', async (_e, { id }) => {
    if (db.mode === 'neon') {
      await db.sql('DELETE FROM lists WHERE id=$1', [id]);
    } else {
      db.local.cards = db.local.cards.filter(c => c.list_id !== id);
      db.local.lists = db.local.lists.filter(l => l.id !== id);
      db.saveLocal();
    }
    return true;
  });

  ipcMain.handle('lists:reorder', async (_e, { orderedIds }) => {
    if (db.mode === 'neon') {
      for (let i = 0; i < orderedIds.length; i++) {
        await db.sql('UPDATE lists SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
      }
    } else {
      orderedIds.forEach((id, i) => {
        const l = db.local.lists.find(x => x.id === id);
        if (l) l.position = i;
      });
      db.saveLocal();
    }
    return true;
  });

  // ---------------- CARDS ----------------
  ipcMain.handle('cards:create', async (_e, { listId, title }) => {
    if (db.mode === 'neon') {
      const r = await db.sql(
        'INSERT INTO cards (list_id, title, position) VALUES ($1, $2, (SELECT COALESCE(MAX(position)+1,0) FROM cards WHERE list_id=$1)) RETURNING *',
        [listId, title]
      );
      return r[0];
    }
    const pos = db.local.cards.filter(c => c.list_id === listId).length;
    const card = { id: db.nextId(), list_id: listId, parent_id: null, priority: 'biasa', title, description: '', start_at: null, due_at: null, color: null, completed: false, position: pos, created_at: new Date().toISOString() };
    db.local.cards.push(card);
    db.saveLocal();
    return card;
  });

  ipcMain.handle('cards:update', async (_e, card) => {
    if (db.mode === 'neon') {
      await db.sql(
        'UPDATE cards SET title=$1, description=$2, parent_id=$3, priority=$4, start_at=$5, due_at=$6, color=$7, completed=$8 WHERE id=$9',
        [card.title, card.description || '', card.parent_id || null, card.priority || 'biasa', card.start_at || null, card.due_at || null, card.color || null, !!card.completed, card.id]
      );
    } else {
      const c = db.local.cards.find(x => x.id === card.id);
      if (c) {
        c.title = card.title;
        c.description = card.description || '';
        c.parent_id = card.parent_id || null;
        c.priority = card.priority || 'biasa';
        c.start_at = card.start_at || null;
        c.due_at = card.due_at || null;
        c.color = card.color || null;
        c.completed = !!card.completed;
        db.saveLocal();
      }
    }
    return true;
  });

  ipcMain.handle('cards:delete', async (_e, { id }) => {
    if (db.mode === 'neon') {
      await db.sql('DELETE FROM cards WHERE id=$1', [id]);
    } else {
      db.local.cards = db.local.cards.filter(c => c.id !== id);
      db.saveLocal();
    }
    return true;
  });

  ipcMain.handle('cards:move', async (_e, { cardId, toListId, orderedIds }) => {
    if (db.mode === 'neon') {
      await db.sql('UPDATE cards SET list_id=$1 WHERE id=$2', [toListId, cardId]);
      for (let i = 0; i < orderedIds.length; i++) {
        await db.sql('UPDATE cards SET position=$1 WHERE id=$2', [i, orderedIds[i]]);
      }
    } else {
      const c = db.local.cards.find(x => x.id === cardId);
      if (c) c.list_id = toListId;
      orderedIds.forEach((id, i) => {
        const cc = db.local.cards.find(x => x.id === id);
        if (cc) cc.position = i;
      });
      db.saveLocal();
    }
    return true;
  });

  // ---------------- AUTENTIKASI & USER MANAGEMENT ----------------
  ipcMain.handle('auth:login', async (_e, { username, password }) => {
    const hash = db.hashPassword(password);
    if (db.mode === 'neon') {
      const rows = await db.sql('SELECT * FROM users WHERE username=$1', [username]);
      const user = rows[0];
      if (!user) throw new Error('Username tidak ditemukan');
      if (user.password_hash !== hash) throw new Error('Password salah');
      if (!user.approved) throw new Error('Akun Anda belum disetujui oleh admin');
      return { id: user.id, username: user.username, role: user.role, approved: user.approved };
    } else {
      const user = db.local.users.find(u => u.username === username);
      if (!user) throw new Error('Username tidak ditemukan');
      if (user.password_hash !== hash) throw new Error('Password salah');
      if (!user.approved) throw new Error('Akun Anda belum disetujui oleh admin');
      return { id: user.id, username: user.username, role: user.role, approved: user.approved };
    }
  });

  ipcMain.handle('auth:register', async (_e, { username, password }) => {
    const hash = db.hashPassword(password);
    if (db.mode === 'neon') {
      const exists = await db.sql('SELECT id FROM users WHERE username=$1', [username]);
      if (exists.length) throw new Error('Username sudah digunakan');
      const r = await db.sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, 'user', false]);
      return r[0];
    } else {
      const exists = db.local.users.some(u => u.username === username);
      if (exists) throw new Error('Username sudah digunakan');
      const user = { id: db.nextId(), username, password_hash: hash, role: 'user', approved: false, created_at: new Date().toISOString() };
      db.local.users.push(user);
      db.saveLocal();
      return user;
    }
  });

  ipcMain.handle('users:list', async () => {
    if (db.mode === 'neon') {
      return await db.sql('SELECT id, username, role, approved, created_at FROM users ORDER BY id DESC');
    }
    return db.local.users.map(u => ({ id: u.id, username: u.username, role: u.role, approved: u.approved, created_at: u.created_at })).sort((a, b) => Number(b.id) - Number(a.id));
  });

  ipcMain.handle('users:approve', async (_e, { id, approved }) => {
    if (db.mode === 'neon') {
      await db.sql('UPDATE users SET approved=$1 WHERE id=$2', [approved, id]);
    } else {
      const user = db.local.users.find(u => u.id === id);
      if (user) {
        user.approved = approved;
        db.saveLocal();
      }
    }
    return true;
  });

  ipcMain.handle('users:create', async (_e, { username, password, role }) => {
    const hash = db.hashPassword(password);
    if (db.mode === 'neon') {
      const exists = await db.sql('SELECT id FROM users WHERE username=$1', [username]);
      if (exists.length) throw new Error('Username sudah digunakan');
      const r = await db.sql('INSERT INTO users (username, password_hash, role, approved) VALUES ($1, $2, $3, $4) RETURNING *', [username, hash, role, true]);
      return r[0];
    } else {
      const exists = db.local.users.some(u => u.username === username);
      if (exists) throw new Error('Username sudah digunakan');
      const user = { id: db.nextId(), username, password_hash: hash, role, approved: true, created_at: new Date().toISOString() };
      db.local.users.push(user);
      db.saveLocal();
      return user;
    }
  });

  ipcMain.handle('users:delete', async (_e, { id }) => {
    if (db.mode === 'neon') {
      await db.sql('DELETE FROM users WHERE id=$1', [id]);
    } else {
      db.local.users = db.local.users.filter(u => u.id !== id);
      db.saveLocal();
    }
    return true;
  });

  // ---------------- SCHEDULING ----------------
  ipcMain.handle('cards:upcoming', async () => {
    if (db.mode === 'neon') {
      return await db.sql('SELECT * FROM cards WHERE due_at IS NOT NULL AND completed=false ORDER BY due_at');
    }
    return db.local.cards
      .filter(c => c.due_at && !c.completed)
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  });
}

module.exports = { registerIpcHandlers };
