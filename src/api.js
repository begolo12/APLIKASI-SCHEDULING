// API wrapper around window.api (Electron). Browser localhost uses Vite HTTP API -> Neon.
const hasElectron = typeof window !== 'undefined' && window.api;

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
    createCard: (listId, title) => call('cards:create', { listId, title }),
    updateCard: (card) => call('cards:update', card),
    deleteCard: (id) => call('cards:delete', { id }),
    moveCard: (cardId, toListId, orderedIds) => call('cards:move', { cardId, toListId, orderedIds }),
    getUpcoming: () => call('cards:upcoming'),
    notify: async () => true,
    dbStatus: () => call('db:status')
  };
}

const api = hasElectron ? window.api : createHttpApi();
export default api;
