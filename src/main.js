import './styles/app.css';
import Sortable from 'sortablejs';
import api from './api.js';
import { dueInfo, escapeHtml } from './utils.js';
import { openCardModal } from './components/cardModal.js';
import { renderCalendar } from './components/calendar.js';
import { renderGantt } from './components/gantt.js';

// ---------------- State ----------------
const state = {
  boards: [],
  activeBoardId: null,
  lists: [],
  cards: [],
  view: 'board', // 'board' | 'calendar' | 'gantt'
  search: '',
  dbMode: 'local',
  saveStatus: 'saved',
  saveError: ''
};

const app = document.getElementById('app');
const notified = new Set(); // card ids already notified this session

// ---------------- Data loading ----------------
async function loadBoards() {
  state.boards = await api.getBoards();
  if (!state.activeBoardId && state.boards.length) state.activeBoardId = state.boards[0].id;
}

async function loadActiveBoard() {
  if (!state.activeBoardId) { state.lists = []; state.cards = []; return; }
  const [lists, cards] = await Promise.all([
    api.getLists(state.activeBoardId),
    api.getCards(state.activeBoardId)
  ]);
  state.lists = lists;
  state.cards = cards;
}

// ---------------- Render ----------------
function render() {
  app.innerHTML = `
    <div class="shell">
      ${renderSidebar()}
      <div class="main">
        ${renderTopbar()}
        ${renderSaveBanner()}
        <div id="content"></div>
      </div>
    </div>
  `;
  bindSidebar();
  bindTopbar();
  renderContent();
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">🗂️</div>
        <div class="brand-name">Flow<span>Board</span></div>
      </div>
      <div class="side-label">Papan</div>
      <div id="board-list">
        ${state.boards.map(b => `
          <div class="board-item ${b.id === state.activeBoardId ? 'active' : ''}" data-id="${b.id}">
            <span class="dot"></span>
            <span class="bi-title">${escapeHtml(b.title)}</span>
            <span class="del" data-del-board="${b.id}" title="Hapus papan">🗑</span>
          </div>`).join('')}
      </div>
      <button class="add-board" id="add-board">+ Papan baru</button>
      <div class="sidebar-footer">
        <div class="db-badge">
          <span class="led ${state.dbMode === 'neon' ? 'neon' : 'local'}"></span>
          ${state.dbMode === 'neon' ? 'Neon Postgres' : (state.dbMode === 'mock' ? 'Preview (browser)' : 'Penyimpanan lokal')}
        </div>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const board = state.boards.find(b => b.id === state.activeBoardId);
  return `
    <header class="topbar">
      <h1>${board ? escapeHtml(board.title) : 'FlowBoard'}</h1>
      <div class="view-toggle">
        <button data-view="board" class="${state.view === 'board' ? 'active' : ''}">Papan</button>
        <button data-view="calendar" class="${state.view === 'calendar' ? 'active' : ''}">Kalender</button>
        <button data-view="gantt" class="${state.view === 'gantt' ? 'active' : ''}">Timeline</button>
      </div>
      <div class="search">
        <span class="icon">🔍</span>
        <input id="search" type="text" placeholder="Cari kartu..." value="${escapeHtml(state.search)}" />
      </div>
    </header>
  `;
}

function renderSaveBanner() {
  if (state.saveStatus === 'saved' && !state.saveError) return '';
  const text = state.saveStatus === 'saving' ? 'Menyimpan ke Neon...' : `Gagal simpan: ${escapeHtml(state.saveError)}`;
  const cls = state.saveStatus === 'saving' ? 'saving' : 'failed';
  return `<div class="save-banner ${cls}">${text}</div>`;
}

async function persist(action) {
  state.saveStatus = 'saving';
  state.saveError = '';
  render();
  try {
    const result = await action();
    state.saveStatus = 'saved';
    state.saveError = '';
    return result;
  } catch (e) {
    state.saveStatus = 'failed';
    state.saveError = e.message || 'unknown error';
    throw e;
  } finally {
    render();
  }
}

function renderContent() {
  const content = document.getElementById('content');
  if (state.view === 'calendar') {
    content.className = 'calendar-wrap';
    renderCalendar(content, state.cards, openCardById);
    return;
  }
  if (state.view === 'gantt') {
    content.className = 'gantt-wrap';
    // Filter cards to current search query if present
    const filteredCards = state.cards.filter(c => !state.search || c.title.toLowerCase().includes(state.search.toLowerCase()));
    renderGantt(content, filteredCards, openCardById, async (cardId, startAt, dueAt) => {
      const card = state.cards.find(c => c.id === cardId);
      if (card) {
        card.start_at = startAt;
        card.due_at = dueAt;
        await api.updateCard(card);
        // Do not full render(), just refresh Gantt content to keep navigation state smooth
        const contentWrap = document.getElementById('content');
        const searchVal = document.getElementById('search') ? document.getElementById('search').value : '';
        const searchFiltered = state.cards.filter(c => !searchVal || c.title.toLowerCase().includes(searchVal.toLowerCase()));
        renderGantt(contentWrap, searchFiltered, openCardById, async (cid, sAt, dAt) => {
          const cd = state.cards.find(x => x.id === cid);
          if (cd) {
            cd.start_at = sAt;
            cd.due_at = dAt;
            await api.updateCard(cd);
            renderContent();
          }
        });
      }
    });
    return;
  }
  content.className = 'board-scroll';
  content.innerHTML = `<div class="board" id="board"></div>`;
  const boardEl = document.getElementById('board');

  const sorted = [...state.lists].sort((a, b) => a.position - b.position);
  for (const list of sorted) {
    boardEl.appendChild(renderList(list));
  }

  const addListBtn = document.createElement('button');
  addListBtn.className = 'add-list';
  addListBtn.textContent = '+ Tambah kolom';
  addListBtn.onclick = addList;
  boardEl.appendChild(addListBtn);

  setupDragAndDrop(boardEl);
}

function renderList(list) {
  const el = document.createElement('div');
  el.className = 'list';
  el.dataset.listId = list.id;

  const cards = state.cards
    .filter(c => c.list_id === list.id)
    .filter(c => !state.search || c.title.toLowerCase().includes(state.search.toLowerCase()))
    .sort((a, b) => a.position - b.position);

  el.innerHTML = `
    <div class="list-head">
      <div class="title" contenteditable="true" spellcheck="false">${escapeHtml(list.title)}</div>
      <span class="count">${cards.length}</span>
      <span class="del" title="Hapus kolom">🗑</span>
    </div>
    <div class="cards" data-list-id="${list.id}"></div>
    <button class="add-parent-card">+ Pekerjaan induk</button>
    <button class="add-card">+ Tambah kartu</button>
  `;

  const cardsEl = el.querySelector('.cards');
  for (const card of cards) cardsEl.appendChild(renderCard(card));

  // Rename list
  const titleEl = el.querySelector('.title');
  titleEl.addEventListener('blur', () => {
    const t = titleEl.textContent.trim() || 'Tanpa nama';
    if (t !== list.title) { api.renameList(list.id, t); list.title = t; }
  });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  el.querySelector('.del').addEventListener('click', async () => {
    if (confirm(`Hapus kolom "${list.title}" beserta semua kartunya?`)) {
      await api.deleteList(list.id);
      await refresh();
    }
  });

  el.querySelector('.add-parent-card').addEventListener('click', async () => {
    const card = await persist(() => api.createCard(list.id, 'Pekerjaan induk baru'));
    card.parent_id = null;
    state.cards.push(card);
    renderContent();
    openCardById(card.id);
  });

  el.querySelector('.add-card').addEventListener('click', async () => {
    const card = await persist(() => api.createCard(list.id, 'Kartu baru'));
    state.cards.push(card);
    renderContent();
    openCardById(card.id);
  });

  return el;
}

function renderCard(card) {
  const el = document.createElement('div');
  const isSubtask = !!card.parent_id;
  el.className = `card ${card.completed ? 'completed' : ''}`;
  if (isSubtask) {
    el.style.marginLeft = '14px';
    el.style.borderLeft = '3px solid var(--accent)';
  }
  el.dataset.cardId = card.id;

  const di = dueInfo(card.due_at, card.completed);
  const children = state.cards.filter(c => String(c.parent_id) === String(card.id));
  const done = children.filter(c => c.completed).length;
  const progress = !isSubtask && children.length ? `<div class="card-progress">Subtask: ${done}/${children.length} selesai</div>` : '';
  
  const priorityLabels = {
    'tinggi': '<span class="due-pill soon">🔴 Tinggi</span>',
    'rendah': '<span class="due-pill done">🟢 Rendah</span>',
    'biasa': ''
  };
  const priorityBadge = priorityLabels[card.priority] || '';

  el.innerHTML = `
    ${card.color ? `<div class="card-color-bar" style="background:${card.color}"></div>` : ''}
    <div class="card-title">${isSubtask ? '<span style="color:var(--text-faint);margin-right:6px;">↳</span>' : ''}${escapeHtml(card.title)}</div>
    ${progress}
    ${di || priorityBadge ? `<div class="card-meta">
      ${priorityBadge}
      ${di ? `<span class="due-pill ${di.state}">🕘 ${di.label}</span>` : ''}
    </div>` : ''}
  `;
  el.addEventListener('click', () => openCardById(card.id));
  return el;
}

// ---------------- Drag and drop ----------------
function setupDragAndDrop(boardEl) {
  // Lists are reorderable
  Sortable.create(boardEl, {
    animation: 180,
    handle: '.list-head',
    draggable: '.list',
    filter: '.add-list',
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    onEnd: async () => {
      const orderedIds = [...boardEl.querySelectorAll('.list')].map(el => Number(el.dataset.listId));
      orderedIds.forEach((id, i) => { const l = state.lists.find(x => x.id === id); if (l) l.position = i; });
      await api.reorderLists(state.activeBoardId, orderedIds);
    }
  });

  // Cards are draggable within & between lists
  boardEl.querySelectorAll('.cards').forEach(cardsEl => {
    Sortable.create(cardsEl, {
      group: 'cards',
      animation: 180,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: async (evt) => {
        const toListEl = evt.to;
        const toListId = Number(toListEl.dataset.listId);
        const cardId = Number(evt.item.dataset.cardId);
        const orderedIds = [...toListEl.querySelectorAll('.card')].map(el => Number(el.dataset.cardId));

        const card = state.cards.find(c => c.id === cardId);
        if (card) card.list_id = toListId;
        orderedIds.forEach((id, i) => { const c = state.cards.find(x => x.id === id); if (c) c.position = i; });

        await api.moveCard(cardId, toListId, orderedIds);
        // update counts without full re-render
        boardEl.querySelectorAll('.list').forEach(listEl => {
          const lid = Number(listEl.dataset.listId);
          const count = state.cards.filter(c => c.list_id === lid).length;
          listEl.querySelector('.count').textContent = count;
        });
      }
    });
  });
}

// ---------------- Actions ----------------
function openCardById(id) {
  const card = state.cards.find(c => c.id === id);
  if (!card) return;
  openCardModal(card, {
    cards: state.cards,
    onCreateSubtask: async () => {
      const sub = await persist(() => api.createCard(card.list_id, 'Subtask baru'));
      sub.parent_id = card.id;
      await persist(() => api.updateCard(sub));
      state.cards.push(sub);
      renderContent();
      return sub;
    },
    onSave: async (updated) => {
      await persist(() => api.updateCard(updated));
      Object.assign(card, updated);
      renderContent();
    },
    onDelete: async (cardId) => {
      await persist(() => api.deleteCard(cardId));
      state.cards = state.cards.filter(c => c.id !== cardId);
      renderContent();
    }
  });
}

async function addList() {
  const list = await api.createList(state.activeBoardId, 'Kolom baru');
  state.lists.push(list);
  renderContent();
}

async function refresh() {
  await loadActiveBoard();
  renderContent();
}

// ---------------- Bindings ----------------
function bindSidebar() {
  document.querySelectorAll('.board-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-del-board]')) return;
      state.activeBoardId = Number(el.dataset.id);
      await loadActiveBoard();
      render();
    });
  });

  document.querySelectorAll('[data-del-board]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.delBoard);
      const board = state.boards.find(b => b.id === id);
      if (confirm(`Hapus papan "${board?.title}"?`)) {
        await api.deleteBoard(id);
        await loadBoards();
        if (state.activeBoardId === id) state.activeBoardId = state.boards[0]?.id ?? null;
        await loadActiveBoard();
        render();
      }
    });
  });

  document.getElementById('add-board').addEventListener('click', async () => {
    const title = prompt('Nama papan baru:', 'Papan Saya');
    if (!title) return;
    const board = await api.createBoard(title);
    state.boards.push(board);
    state.activeBoardId = board.id;
    await loadActiveBoard();
    render();
  });
}

function bindTopbar() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      render();
    });
  });

  const searchEl = document.getElementById('search');
  searchEl.addEventListener('input', () => {
    state.search = searchEl.value;
    renderContent();
  });
}

// ---------------- Reminder scheduler ----------------
function startReminderLoop() {
  setInterval(async () => {
    const now = Date.now();
    for (const c of state.cards) {
      if (!c.due_at || c.completed || notified.has(c.id)) continue;
      const due = new Date(c.due_at).getTime();
      // Fire when due time is within the last 60s window
      if (due <= now && now - due < 60000) {
        notified.add(c.id);
        api.notify('⏰ FlowBoard — Jatuh tempo', c.title);
      }
    }
  }, 30000);
}

// ---------------- Boot ----------------
async function boot() {
  try {
    const status = await api.dbStatus();
    state.dbMode = status.mode;
  } catch { state.dbMode = 'local'; }

  await loadBoards();
  await loadActiveBoard();
  render();
  startReminderLoop();
}

boot();
