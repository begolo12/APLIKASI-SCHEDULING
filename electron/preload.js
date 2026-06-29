const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge: renderer never touches DB credentials directly.
contextBridge.exposeInMainWorld('api', {
  // Boards
  getBoards: () => ipcRenderer.invoke('boards:list'),
  createBoard: (title) => ipcRenderer.invoke('boards:create', { title }),
  renameBoard: (id, title) => ipcRenderer.invoke('boards:rename', { id, title }),
  deleteBoard: (id) => ipcRenderer.invoke('boards:delete', { id }),

  // Board-scoped fetches
  getLists: (boardId) => ipcRenderer.invoke('lists:list', { boardId }),
  getCards: (boardId) => ipcRenderer.invoke('cards:list', { boardId }),

  // Lists
  createList: (boardId, title) => ipcRenderer.invoke('lists:create', { boardId, title }),
  renameList: (id, title) => ipcRenderer.invoke('lists:rename', { id, title }),
  deleteList: (id) => ipcRenderer.invoke('lists:delete', { id }),
  reorderLists: (boardId, orderedIds) => ipcRenderer.invoke('lists:reorder', { boardId, orderedIds }),

  // Cards
  createCard: (listId, title) => ipcRenderer.invoke('cards:create', { listId, title }),
  updateCard: (card) => ipcRenderer.invoke('cards:update', card),
  deleteCard: (id) => ipcRenderer.invoke('cards:delete', { id }),
  moveCard: (cardId, toListId, orderedIds) => ipcRenderer.invoke('cards:move', { cardId, toListId, orderedIds }),

  // Scheduling
  getUpcoming: () => ipcRenderer.invoke('cards:upcoming'),

  // Desktop notification
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // DB status
  dbStatus: () => ipcRenderer.invoke('db:status')
});
