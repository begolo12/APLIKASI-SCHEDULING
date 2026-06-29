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
  createCard: (listId, title, ctx) => ipcRenderer.invoke('cards:create', { listId, title, userId: ctx?.userId, username: ctx?.username }),
  updateCard: (card, ctx) => ipcRenderer.invoke('cards:update', { ...card, _userId: ctx?.userId, _username: ctx?.username }),
  deleteCard: (id, ctx) => ipcRenderer.invoke('cards:delete', { id, userId: ctx?.userId, username: ctx?.username }),
  moveCard: (cardId, toListId, orderedIds, ctx) => ipcRenderer.invoke('cards:move', { cardId, toListId, orderedIds, userId: ctx?.userId, username: ctx?.username }),

  // Labels
  getLabels: (boardId) => ipcRenderer.invoke('labels:list', { boardId }),
  createLabel: (boardId, name, color) => ipcRenderer.invoke('labels:create', { boardId, name, color }),
  renameLabel: (id, name) => ipcRenderer.invoke('labels:rename', { id, name }),
  deleteLabel: (id) => ipcRenderer.invoke('labels:delete', { id }),

  // Card-label associations
  getCardLabels: (cardId) => ipcRenderer.invoke('cards:labels', { cardId }),
  setCardLabels: (cardId, labelIds) => ipcRenderer.invoke('cards:labels:set', { cardId, labelIds }),

  // History
  getCardHistory: (cardId, limit) => ipcRenderer.invoke('cards:history', { cardId, limit }),

  // Export / Import
  exportAll: () => ipcRenderer.invoke('export:all'),
  importAll: (payload) => ipcRenderer.invoke('import:all', payload),

  // Recurring
  runRecurring: () => ipcRenderer.invoke('recurring:run'),

  // Scheduling
  getUpcoming: () => ipcRenderer.invoke('cards:upcoming'),

  // Desktop notification
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // DB status
  dbStatus: () => ipcRenderer.invoke('db:status'),

  // Auth & Users
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  register: (username, password) => ipcRenderer.invoke('auth:register', { username, password }),
  getUsers: () => ipcRenderer.invoke('users:list'),
  approveUser: (id, approved) => ipcRenderer.invoke('users:approve', { id, approved }),
  createUser: (username, password, role) => ipcRenderer.invoke('users:create', { username, password, role }),
  deleteUser: (id) => ipcRenderer.invoke('users:delete', { id })
});
