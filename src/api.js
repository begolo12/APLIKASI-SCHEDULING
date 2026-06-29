// API wrapper. Uses window.api (Electron) if present, else Vite HTTP API → Neon.
const hasElectron = typeof window !== 'undefined' && window.api;

function ctx() {
  try {
    const u = JSON.parse(localStorage.getItem('flowboard-user') || 'null');
    return { userId: u?.id ?? null, username: u?.username ?? null };
  } catch { return { userId: null, username: null }; }
}

function createHttpApi() {
  const call = async (channel, payload = {}) => {
    const res = await fetch(`/api/${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };
  return {
    getBoards: () => call('boards:list'),
    createBoard: (title) => call('boards:create', { title }),
    renameBoard: (id, title) => call('boards:rename', { id, title }),
    deleteBoard: (id) => call('boards:delete', { id }),
    getLists: (boardId) => call('lists:list', { boardId }),
    getCards: (boardId) => call('cards:list', { boardId }),
    createList: (boardId, title) => call('lists:create', { boardId, title }),
    renameList: (id, title) => call('lists:rename', { id, title }),
    deleteList: (id) => call('lists:delete', { id }),
    reorderLists: (boardId, orderedIds) => call('lists:reorder', { boardId, orderedIds }),
    createCard: (listId, title) => {
      const c = ctx();
      return call('cards:create', { listId, title, userId: c.userId, username: c.username });
    },
    updateCard: (card) => {
      const c = ctx();
      return call('cards:update', { ...card, _userId: c.userId, _username: c.username });
    },
    deleteCard: (id) => {
      const c = ctx();
      return call('cards:delete', { id, userId: c.userId, username: c.username });
    },
    moveCard: (cardId, toListId, orderedIds) => {
      const c = ctx();
      return call('cards:move', { cardId, toListId, orderedIds, userId: c.userId, username: c.username });
    },
    getUpcoming: () => call('cards:upcoming'),
    runRecurring: () => call('recurring:run'),
    notify: async () => true,
    dbStatus: () => call('db:status'),

    // Labels
    getLabels: (boardId) => call('labels:list', { boardId }),
    createLabel: (boardId, name, color) => call('labels:create', { boardId, name, color }),
    renameLabel: (id, name) => call('labels:rename', { id, name }),
    deleteLabel: (id) => call('labels:delete', { id }),

    // Card labels
    getCardLabels: (cardId) => call('cards:labels', { cardId }),
    setCardLabels: (cardId, labelIds) => call('cards:labels:set', { cardId, labelIds }),

    // History
    getCardHistory: (cardId, limit) => call('cards:history', { cardId, limit }),

    // Export / Import
    exportAll: () => call('export:all'),
    importAll: (payload) => call('import:all', payload),

    // Auth & Users
    login: (username, password) => call('auth:login', { username, password }),
    register: (username, password) => call('auth:register', { username, password }),
    getUsers: () => call('users:list'),
    approveUser: (id, approved) => call('users:approve', { id, approved }),
    createUser: (username, password, role) => call('users:create', { username, password, role }),
    deleteUser: (id) => call('users:delete', { id })
  };
}

const api = hasElectron ? window.api : createHttpApi();
export default api;
