import './styles/app.css';
import Sortable from 'sortablejs';
import api from './api.js';
import { dueInfo, escapeHtml, describeRule } from './utils.js';
import { openCardModal } from './components/cardModal.js';
import { renderCalendar } from './components/calendar.js';
import { renderGantt } from './components/gantt.js';

// ---------------- State ----------------
const savedUser = typeof localStorage !== 'undefined' ? localStorage.getItem('flowboard-user') : null;
const state = {
  boards: [],
  activeBoardId: null,
  lists: [],
  cards: [],
  labels: [],          // labels for active board
  cardLabelsMap: {},   // cardId -> [{id, name, color}]
  view: 'board',       // 'board' | 'calendar' | 'gantt' | 'settings'
  search: '',
  filterLabelId: null, // null = all
  filterPriority: '',  // '' = all
  filterDue: '',       // '' = all, 'overdue', 'today', 'week', 'open'
  dbMode: 'neon',
  saveStatus: 'saved',
  saveError: '',
  user: savedUser ? JSON.parse(savedUser) : null,
  usersList: [],
  usersListLoaded: false,
  sidebarCollapsed: typeof localStorage !== 'undefined' ? localStorage.getItem('flowboard-sidebar-collapsed') === 'true' : false
};

const app = document.getElementById('app');
const notified = new Set(); // card ids already notified this session

// ---------------- Data loading ----------------
async function loadBoards() {
  state.boards = await api.getBoards();
  if (!state.activeBoardId && state.boards.length) state.activeBoardId = state.boards[0].id;
}

async function loadActiveBoard() {
  if (!state.activeBoardId) { state.lists = []; state.cards = []; state.labels = []; state.cardLabelsMap = {}; return; }
  const [lists, cards, labels, cardLabels] = await Promise.all([
    api.getLists(state.activeBoardId),
    api.getCards(state.activeBoardId),
    api.getLabels(state.activeBoardId),
    api.getBoardsCardsLabels(state.activeBoardId).catch(() => [])
  ]);
  state.lists = lists;
  state.cards = cards;
  state.labels = labels || [];

  // Map card-label associations from batch result
  const labelMap = {};
  for (const c of cards) {
    labelMap[String(c.id)] = [];
  }
  if (Array.isArray(cardLabels)) {
    for (const r of cardLabels) {
      const cid = String(r.card_id);
      if (labelMap[cid]) {
        labelMap[cid].push({
          id: r.id,
          board_id: r.board_id,
          name: r.name,
          color: r.color,
          created_at: r.created_at
        });
      }
    }
  }
  state.cardLabelsMap = labelMap;
}

function getCardLabels(cardId) {
  return state.cardLabelsMap[String(cardId)] || [];
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
    <aside class="sidebar ${state.sidebarCollapsed ? 'collapsed' : ''}" id="sidebar">
      <div class="brand">
        <div class="brand-logo">🗂️</div>
        <div class="brand-name">Flow<span>Board</span></div>
      </div>
      <div class="side-label">Papan</div>
      <div id="board-list">
        ${state.boards.map(b => `
          <div class="board-item ${b.id === state.activeBoardId && state.view !== 'settings' ? 'active' : ''}" data-id="${b.id}">
            <span class="dot"></span>
            <span class="bi-title">${escapeHtml(b.title)}</span>
            <span class="del" data-del-board="${b.id}" title="Hapus papan">🗑</span>
          </div>`).join('')}
      </div>
      <button class="add-board" id="add-board">+ Papan baru</button>

      <div class="side-label" style="margin-top: 24px;">Menu</div>
      <div class="sidebar-nav">
        <div class="nav-item ${state.view === 'settings' ? 'active' : ''}" id="nav-settings">
          <span style="margin-right:8px;">⚙️</span> Pengaturan
        </div>
      </div>

      <div class="sidebar-footer">
        ${state.user ? `
        <div class="user-profile-badge">
          <div class="up-avatar">👤</div>
          <div class="up-info">
            <div class="up-name">${escapeHtml(state.user.username)}</div>
            <div class="up-role">${state.user.role === 'admin' ? 'Super Admin' : 'Anggota'}</div>
          </div>
        </div>
        ` : ''}
        <div class="db-badge">
          <span class="led ${state.dbMode === 'neon' ? 'neon' : 'local'}"></span>
          ${state.dbMode === 'neon' ? 'Neon Postgres' : (state.dbMode === 'mock' ? 'Preview (browser)' : 'Mode lokal')}
        </div>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const toggleBtnHtml = `<button class="sidebar-toggle-btn" id="toggle-sidebar" title="Tampilkan/Sembunyikan Sidebar">📂</button>`;
  if (state.view === 'settings') {
    return `
      <header class="topbar">
        ${toggleBtnHtml}
        <h1 style="margin-left: 10px;">Pengaturan Aplikasi</h1>
      </header>
    `;
  }
  const board = state.boards.find(b => b.id === state.activeBoardId);
  return `
    <header class="topbar">
      ${toggleBtnHtml}
      <h1 style="margin-left: 10px;">${board ? escapeHtml(board.title) : 'FlowBoard'}</h1>
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

function renderFilterBar() {
  if (state.view !== 'board' && state.view !== 'calendar' && state.view !== 'gantt') return '';
  return `
    <div class="filter-bar">
      <div class="filter-group">
        <label>Label:</label>
        <select id="filter-label" style="background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:4px 8px; color:var(--text); font-size:12px; outline:none;">
          <option value="">Semua</option>
          ${state.labels.map(l => `<option value="${l.id}" ${state.filterLabelId == l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Prioritas:</label>
        <select id="filter-priority" style="background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:4px 8px; color:var(--text); font-size:12px; outline:none;">
          <option value="">Semua</option>
          <option value="tinggi" ${state.filterPriority === 'tinggi' ? 'selected' : ''}>🔴 Tinggi</option>
          <option value="biasa" ${state.filterPriority === 'biasa' ? 'selected' : ''}>🟡 Biasa</option>
          <option value="rendah" ${state.filterPriority === 'rendah' ? 'selected' : ''}>🟢 Rendah</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Tenggat:</label>
        <select id="filter-due" style="background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:4px 8px; color:var(--text); font-size:12px; outline:none;">
          <option value="">Semua</option>
          <option value="open" ${state.filterDue === 'open' ? 'selected' : ''}>Belum selesai</option>
          <option value="overdue" ${state.filterDue === 'overdue' ? 'selected' : ''}>Terlambat</option>
          <option value="today" ${state.filterDue === 'today' ? 'selected' : ''}>Hari ini</option>
          <option value="week" ${state.filterDue === 'week' ? 'selected' : ''}>7 hari ke depan</option>
        </select>
      </div>
      <button id="filter-clear" class="btn btn-ghost" style="padding:4px 10px; font-size:11px; height:26px; display:${(state.filterLabelId || state.filterPriority || state.filterDue) ? 'inline-flex' : 'none'}; align-items:center;">Reset</button>
    </div>
  `;
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

function applyFilters(cards) {
  let out = cards;
  if (state.search) {
    const s = state.search.toLowerCase();
    out = out.filter(c => c.title.toLowerCase().includes(s));
  }
  if (state.filterLabelId) {
    const lid = Number(state.filterLabelId);
    out = out.filter(c => getCardLabels(c.id).some(l => Number(l.id) === lid));
  }
  if (state.filterPriority) {
    out = out.filter(c => c.priority === state.filterPriority);
  }
  if (state.filterDue) {
    const now = new Date();
    const oneDay = 86400000;
    out = out.filter(c => {
      if (state.filterDue === 'open') return !c.completed;
      if (state.filterDue === 'overdue') return c.due_at && !c.completed && new Date(c.due_at) < now;
      if (state.filterDue === 'today') {
        if (!c.due_at) return false;
        const d = new Date(c.due_at);
        return d.toDateString() === now.toDateString();
      }
      if (state.filterDue === 'week') {
        if (!c.due_at) return false;
        const d = new Date(c.due_at);
        return d >= now && (d - now) < 7 * oneDay;
      }
      return true;
    });
  }
  return out;
}

function renderContent() {
  const content = document.getElementById('content');
  if (state.view === 'settings') {
    content.className = 'settings-wrap';
    if (state.user.role === 'admin' && !state.usersListLoaded) {
      content.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Memuat data pengguna...</div>';
      api.getUsers().then(list => {
        state.usersList = list;
        state.usersListLoaded = true;
        renderSettings(content);
      }).catch(err => {
        console.error(err);
        state.usersListLoaded = true;
        renderSettings(content);
      });
    } else {
      renderSettings(content);
    }
    return;
  }

  // Insert filter bar before content
  const existingFilter = document.querySelector('.filter-bar');
  if (existingFilter) existingFilter.remove();
  const filterHtml = renderFilterBar();
  if (filterHtml) {
    const tmp = document.createElement('div');
    tmp.innerHTML = filterHtml;
    content.parentNode.insertBefore(tmp.firstElementChild, content);
  }
  bindFilterBar();

  if (state.view === 'calendar') {
    content.className = 'calendar-wrap';
    renderCalendar(content, applyFilters(state.cards), openCardById, async (cardId, isoDate) => {
      const card = state.cards.find(c => Number(c.id) === Number(cardId));
      if (!card) return;

      const prevDue = card.due_at ? new Date(card.due_at) : new Date();
      const prevStart = card.start_at ? new Date(card.start_at) : null;
      const [y, m, d] = isoDate.split('-').map(Number);
      const nextDue = new Date(y, m - 1, d, prevDue.getHours(), prevDue.getMinutes());

      if (prevStart) {
        const durationMs = prevDue.getTime() - prevStart.getTime();
        const nextStart = new Date(nextDue.getTime() - durationMs);
        card.start_at = nextStart.toISOString();
      }

      card.due_at = nextDue.toISOString();
      await api.updateCard(card);
      renderContent();
    });
    return;
  }
  if (state.view === 'gantt') {
    content.className = 'gantt-wrap';
    const filteredCards = applyFilters(state.cards);
    renderGantt(content, filteredCards, openCardById, async (cardId, startAt, dueAt) => {
      const card = state.cards.find(c => c.id === cardId);
      if (card) {
        card.start_at = startAt;
        card.due_at = dueAt;
        await api.updateCard(card);
        const contentWrap = document.getElementById('content');
        const searchVal = document.getElementById('search') ? document.getElementById('search').value : '';
        const localState = { ...state, search: searchVal };
        const refreshed = applyFilters(state.cards);
        renderGantt(contentWrap, refreshed, openCardById, async (cid, sAt, dAt) => {
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

  const listCards = applyFilters(state.cards)
    .filter(c => c.list_id === list.id)
    .sort((a, b) => a.position - b.position);

  // Group subtasks under parents
  const rootsInList = [];
  const subtasksInList = [];

  listCards.forEach(c => {
    if (c.parent_id) {
      const parentExists = state.cards.some(p => String(p.id) === String(c.parent_id));
      if (parentExists) {
        subtasksInList.push(c);
      } else {
        rootsInList.push(c);
      }
    } else {
      rootsInList.push(c);
    }
  });

  const renderedParentIds = new Set();
  const itemsToRender = [];

  rootsInList.forEach(parent => {
    itemsToRender.push({ type: 'real', card: parent, isSub: false });
    renderedParentIds.add(String(parent.id));

    const subs = subtasksInList.filter(s => String(s.parent_id) === String(parent.id));
    subs.forEach(sub => {
      itemsToRender.push({ type: 'real', card: sub, isSub: true });
    });
  });

  subtasksInList.forEach(sub => {
    const parentIdStr = String(sub.parent_id);
    if (!renderedParentIds.has(parentIdStr)) {
      const parentCard = state.cards.find(p => String(p.id) === parentIdStr);
      if (parentCard) {
        itemsToRender.push({ type: 'virtual', card: parentCard, isSub: false });
        renderedParentIds.add(parentIdStr);

        const sisterSubs = subtasksInList.filter(s => String(s.parent_id) === parentIdStr);
        sisterSubs.forEach(s => {
          itemsToRender.push({ type: 'real', card: s, isSub: true });
        });
      } else {
        itemsToRender.push({ type: 'real', card: sub, isSub: false });
      }
    }
  });

  el.innerHTML = `
    <div class="list-head">
      <div class="title" contenteditable="true" spellcheck="false">${escapeHtml(list.title)}</div>
      <span class="count">${listCards.length}</span>
      <span class="del" title="Hapus kolom">🗑</span>
    </div>
    <div class="cards" data-list-id="${list.id}"></div>
    <button class="add-parent-card">+ Pekerjaan induk</button>
    <button class="add-card">+ Tambah kartu</button>
  `;

  const cardsEl = el.querySelector('.cards');
  for (const item of itemsToRender) {
    cardsEl.appendChild(renderCard(item.card, item.type === 'virtual', item.isSub));
  }

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

function renderCard(card, isVirtual = false, isSubtask = false) {
  const el = document.createElement('div');
  const isParentCard = !isSubtask && state.cards.some(c => String(c.parent_id) === String(card.id));
  el.className = `card ${card.completed ? 'completed' : ''} ${isVirtual ? 'virtual-parent' : ''} ${isParentCard ? 'parent-card' : ''}`;
  if (isSubtask) {
    el.style.marginLeft = '14px';
    el.style.borderLeft = '3px solid var(--accent)';
  }
  if (isVirtual) {
    el.style.opacity = '0.65';
    el.style.border = '1px dashed var(--border-strong)';
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

  const cardLabels = getCardLabels(card.id);
  const labelChips = cardLabels.length
    ? `<div class="card-labels">${cardLabels.map(l => `<span class="card-label" style="--lc:${l.color}">${escapeHtml(l.name)}</span>`).join('')}</div>`
    : '';

  const rule = describeRule(card);
  const recurringBadge = rule ? `<span class="due-pill normal" title="${escapeHtml(rule)}">🔁 Berulang</span>` : '';

  el.innerHTML = `
    ${card.color ? `<div class="card-color-bar" style="background:${card.color}"></div>` : ''}
    <div class="card-title">${isSubtask ? '<span style="color:var(--text-faint);margin-right:6px;">↳</span>' : ''}${escapeHtml(card.title)}</div>
    ${labelChips}
    ${progress}
    ${(di || priorityBadge || recurringBadge) ? `<div class="card-meta">
      ${priorityBadge}
      ${recurringBadge}
      ${di ? `<span class="due-pill ${di.state}">🕘 ${di.label}</span>` : ''}
    </div>` : ''}
  `;
  el.addEventListener('click', () => openCardById(card.id));
  return el;
}

// ---------------- Drag and drop ----------------
function setupDragAndDrop(boardEl) {
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

  boardEl.querySelectorAll('.cards').forEach(cardsEl => {
    Sortable.create(cardsEl, {
      group: 'cards',
      animation: 180,
      filter: '.virtual-parent, .parent-card',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: async (evt) => {
        const toListEl = evt.to;
        const toListId = Number(toListEl.dataset.listId);
        const cardId = Number(evt.item.dataset.cardId);
        const orderedIds = [...toListEl.querySelectorAll('.card:not(.virtual-parent):not(.parent-card)')].map(el => Number(el.dataset.cardId));

        const card = state.cards.find(c => c.id === cardId);
        if (card) card.list_id = toListId;
        orderedIds.forEach((id, i) => { const c = state.cards.find(x => x.id === id); if (c) c.position = i; });

        await api.moveCard(cardId, toListId, orderedIds);
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
async function openCardById(id) {
  const card = state.cards.find(c => c.id === id);
  if (!card) return;
  const cardLabels = getCardLabels(card.id);
  let history = [];
  try { history = await api.getCardHistory(card.id, 50) || []; } catch (e) { console.warn('history load failed', e); }

  openCardModal(card, {
    cards: state.cards,
    labels: state.labels,
    cardLabels,
    history,
    boardId: state.activeBoardId,
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
      // Refresh history so user sees their own change
      try {
        const fresh = await api.getCardHistory(card.id, 50);
        const histEl = document.getElementById('cm-history');
        if (histEl) histEl.innerHTML = (fresh || []).slice(0, 30).map(h => `
          <div class="history-item">
            <div class="history-icon">${historyIcon(h.action)}</div>
            <div class="history-body">
              <div class="history-line"><strong>${escapeHtml(h.username || 'Seseorang')}</strong> ${escapeHtml(describeAction(h.action, h.details || {}))}</div>
              <div class="history-time">${escapeHtml(timeAgo(h.created_at))} • ${escapeHtml(new Date(h.created_at).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }))}</div>
            </div>
          </div>
        `).join('') || '<div style="font-size:12px; color:var(--text-faint); padding: 6px 2px;">Belum ada aktivitas.</div>';
      } catch {}
      renderContent();
    },
    onDelete: async (cardId) => {
      await persist(() => api.deleteCard(cardId));
      state.cards = state.cards.filter(c => c.id !== cardId);
      renderContent();
    },
    onLabelsChange: async (labelIds) => {
      await api.setCardLabels(card.id, labelIds);
      state.cardLabelsMap[String(card.id)] = state.labels.filter(l => labelIds.includes(Number(l.id)));
    },
    onCreateLabel: async (name, color) => {
      const created = await api.createLabel(state.activeBoardId, name, color);
      state.labels.push(created);
      return created;
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
      state.view = 'board';
      await loadActiveBoard();
      render();
    });
  });

  const settingsEl = document.getElementById('nav-settings');
  if (settingsEl) {
    settingsEl.onclick = async () => {
      state.view = 'settings';
      state.usersListLoaded = false;
      render();
    };
  }

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
    state.view = 'board';
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
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.search = searchEl.value;
      renderContent();
    });
  }

  const toggleBtn = document.getElementById('toggle-sidebar');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('flowboard-sidebar-collapsed', state.sidebarCollapsed);
      }
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        if (state.sidebarCollapsed) {
          sidebar.classList.add('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
        }
      }
    });
  }
}

function bindFilterBar() {
  const fl = document.getElementById('filter-label');
  const fp = document.getElementById('filter-priority');
  const fd = document.getElementById('filter-due');
  const fc = document.getElementById('filter-clear');
  if (fl) fl.onchange = () => { state.filterLabelId = fl.value || null; renderContent(); };
  if (fp) fp.onchange = () => { state.filterPriority = fp.value || ''; renderContent(); };
  if (fd) fd.onchange = () => { state.filterDue = fd.value || ''; renderContent(); };
  if (fc) fc.onclick = () => { state.filterLabelId = null; state.filterPriority = ''; state.filterDue = ''; renderContent(); };
}

// Reminder helper exports (used by openCardModal render path)
function historyIcon(action) {
  if (action === 'card.create') return '✨';
  if (action === 'card.delete') return '🗑';
  if (action === 'card.move') return '↔';
  if (action === 'recurring.spawn') return '🔁';
  return '✎';
}
function describeAction(action, details = {}) {
  switch (action) {
    case 'card.create': return 'membuat kartu';
    case 'card.update': {
      const fields = Object.keys(details);
      if (!fields.length) return 'memperbarui kartu';
      return `mengubah: ${fields.join(', ')}`;
    }
    case 'card.delete': return 'menghapus kartu';
    case 'card.move': return 'memindahkan kartu antar kolom';
    case 'recurring.spawn': return 'membuat occurrence berulang';
    default: return action;
  }
}
function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'baru saja';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ---------------- Reminder scheduler ----------------
function startReminderLoop() {
  setInterval(async () => {
    const now = Date.now();
    for (const c of state.cards) {
      if (!c.due_at || c.completed) continue;
      const due = new Date(c.due_at).getTime();
      if (Number.isNaN(due)) continue;
      const leadMin = [0, 5, 10, 30].includes(Number(c.reminder_minutes)) ? Number(c.reminder_minutes) : 0;
      const fireAt = due - leadMin * 60000;
      const key = `${c.id}:${leadMin}`;
      if (!notified.has(key) && fireAt <= now && now - fireAt < 60000) {
        notified.add(key);
        const prefix = leadMin ? `${leadMin} menit lagi` : 'Jatuh tempo';
        api.notify(`⏰ FlowBoard — ${prefix}`, c.title);
      }
    }
  }, 30000);
}

// ---------------- Boot ----------------
async function boot() {
  // Tampilkan layar loading awal agar tidak ada black screen
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        background-color: #0f1117;
        color: #f3f4f6;
        font-family: 'Outfit', sans-serif;
      ">
        <div style="font-size: 64px; margin-bottom: 20px; animation: pulse 2s infinite ease-in-out;">🗂️</div>
        <div style="font-size: 24px; font-weight: 700; letter-spacing: -0.025em; margin-bottom: 8px;">Flow<span style="color: #6366f1;">Board</span></div>
        <div style="font-size: 13px; color: #9ca3af; display: flex; align-items: center; gap: 8px;">
          <span style="
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #6366f1;
            animation: bounce 1.4s infinite ease-in-out both;
          "></span>
          Menghubungkan ke database...
        </div>
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
      </style>
    `;
  }

  try {
    const status = await api.dbStatus();
    state.dbMode = status.mode || 'neon';
  } catch { state.dbMode = 'neon'; }

  if (!state.user) {
    renderLogin();
    return;
  }

  try {
    await loadBoards();
    await loadActiveBoard();
    render();
    startReminderLoop();
    api.runRecurring().catch(() => {});
  } catch (err) {
    console.error('Boot error:', err);
    app.innerHTML = `
      <div class="login-wrapper">
        <div class="login-card" style="text-align: center; max-width: 480px;">
          <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
          <h2 style="color: var(--text-strong); font-size: 20px; font-weight: 700; margin-bottom: 12px;">Koneksi Database Gagal</h2>
          <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            Aplikasi tidak dapat terhubung ke database cloud Neon Postgres di Vercel.
          </p>
          <div style="color: var(--danger); background: rgba(239,68,68,0.08); padding: 12px; border-radius: var(--r-md); font-size: 13px; font-family: monospace; border: 1px solid rgba(239,68,68,0.18); text-align: left; margin-bottom: 24px; word-break: break-all;">
            ${escapeHtml(err.message || err)}
          </div>
          <button class="btn btn-primary" onclick="localStorage.removeItem('flowboard-user'); location.reload();" style="width: 100%;">
            Keluar & Kembali ke Login
          </button>
        </div>
      </div>
    `;
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="brand" style="margin-bottom: 24px; justify-content: center;">
          <div class="brand-logo">🗂️</div>
          <div class="brand-name">Flow<span>Board</span></div>
        </div>
        <h2 id="auth-title" style="font-size: 20px; font-weight: 700; margin-bottom: 16px; text-align: center; color: var(--text-strong)">Masuk ke Akun</h2>
        <div id="auth-error" class="auth-error hidden" style="color: var(--danger); background: rgba(239,68,68,0.08); padding: 10px 12px; border-radius: var(--r-md); font-size:12.5px; font-weight:600; margin-bottom: 16px; border: 1px solid rgba(239,68,68,0.18)"></div>
        <form id="auth-form" style="display:flex; flex-direction:column; gap:16px;">
          <div class="field" style="margin-bottom:0;">
            <label for="auth-user" style="font-size:12px; margin-bottom:6px; display:block; color:var(--text-muted)">Username</label>
            <input id="auth-user" type="text" placeholder="Masukkan username" required autocomplete="username" style="width:100%; padding:10px 12px; font-size:14px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label for="auth-pass" style="font-size:12px; margin-bottom:6px; display:block; color:var(--text-muted)">Password</label>
            <input id="auth-pass" type="password" placeholder="Masukkan password" required autocomplete="current-password" style="width:100%; padding:10px 12px; font-size:14px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;" />
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 11px; margin-top: 8px; font-size:14px; font-weight:700;" id="auth-submit">Masuk</button>
        </form>
        <div class="auth-switch" style="margin-top: 20px; text-align: center; font-size: 13px; color: var(--text-muted)">
          Belum punya akun? <a href="#" id="auth-toggle-link" style="color: var(--accent); font-weight: 600; text-decoration: none;">Daftar sekarang</a>
        </div>
        <div class="auth-hint" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); font-size:11px; color: var(--text-faint); text-align: center;">Super admin bawaan: <b>admin</b> / <b>admin123</b></div>
      </div>
    </div>
  `;
  bindAuthEvents();
}

function bindAuthEvents() {
  let mode = 'login';
  const form = document.getElementById('auth-form');
  const titleEl = document.getElementById('auth-title');
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');
  const switchEl = document.querySelector('.auth-switch');

  document.getElementById('auth-toggle-link').onclick = (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    if (mode === 'login') {
      mode = 'register';
      titleEl.textContent = 'Daftar Akun Baru';
      submitBtn.textContent = 'Daftar';
      switchEl.innerHTML = 'Sudah punya akun? <a href="#" id="auth-toggle-link" style="color: var(--accent); font-weight: 600; text-decoration: none;">Masuk sekarang</a>';
    } else {
      mode = 'login';
      titleEl.textContent = 'Masuk ke Akun';
      submitBtn.textContent = 'Masuk';
      switchEl.innerHTML = 'Belum punya akun? <a href="#" id="auth-toggle-link" style="color: var(--accent); font-weight: 600; text-decoration: none;">Daftar sekarang</a>';
    }
    bindAuthEvents();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    const userVal = document.getElementById('auth-user').value.trim();
    const passVal = document.getElementById('auth-pass').value;

    try {
      if (mode === 'login') {
        const u = await api.login(userVal, passVal);
        state.user = u;
        localStorage.setItem('flowboard-user', JSON.stringify(u));
        boot();
      } else {
        await api.register(userVal, passVal);
        alert('Pendaftaran sukses! Mohon hubungi super admin untuk menyetujui akun Anda.');
        mode = 'login';
        titleEl.textContent = 'Masuk ke Akun';
        submitBtn.textContent = 'Masuk';
        switchEl.innerHTML = 'Belum punya akun? <a href="#" id="auth-toggle-link" style="color: var(--accent); font-weight: 600; text-decoration: none;">Daftar sekarang</a>';
        document.getElementById('auth-user').value = '';
        document.getElementById('auth-pass').value = '';
        bindAuthEvents();
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  };
}

function renderSettings(container) {
  const isAdmin = state.user.role === 'admin';
  container.innerHTML = `
    <div class="settings-container">
      <div class="settings-card">
        <h2>Profil Pengguna</h2>
        <div class="profile-detail">
          <div class="pd-row"><strong>Username:</strong> <span>${escapeHtml(state.user.username)}</span></div>
          <div class="pd-row"><strong>Role:</strong> <span>${state.user.role === 'admin' ? 'Super Admin' : 'Anggota'}</span></div>
        </div>
        <button class="btn btn-ghost" id="btn-logout" style="margin-top: 16px; color: var(--danger); border-color: rgba(239, 68, 68, 0.2)">Logout</button>
      </div>

      <div class="settings-card" style="margin-top: 24px;">
        <h2>🏷️ Manajemen Label</h2>
        <p style="font-size:12.5px; color:var(--text-muted); margin-top: -4px;">Label dipakai untuk menandai kartu. 1 papan bisa punya banyak label, 1 kartu bisa punya banyak label.</p>
        <form id="label-create-form" style="display:flex; gap: 8px; margin-bottom: 16px; align-items: flex-end; flex-wrap: wrap;">
          <div class="field" style="margin-bottom:0; flex:1; min-width: 160px;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Papan</label>
            <select id="lc-board" style="width:100%; padding: 8px 12px; font-size:13px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;">
              ${state.boards.map(b => `<option value="${b.id}" ${b.id === state.activeBoardId ? 'selected' : ''}>${escapeHtml(b.title)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0; flex:1; min-width: 160px;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Nama Label</label>
            <input id="lc-name" type="text" placeholder="mis. Mendesak" required style="width:100%; padding: 8px 12px; font-size:13px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;" />
          </div>
          <div class="field" style="margin-bottom:0; width: 80px;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Warna</label>
            <input id="lc-color" type="color" value="#6366f1" style="width:100%; height:36px; padding:0; border:1px solid var(--border); border-radius:var(--r-md); background:transparent; cursor:pointer;" />
          </div>
          <button type="submit" class="btn btn-primary" style="padding: 0 16px; font-size:13px; height: 36px; display:flex; align-items:center; justify-content:center;">+ Buat</button>
        </form>

        <div id="label-list">
          ${state.boards.map(b => {
            const labelsForBoard = state.labels.filter(l => Number(l.board_id) === Number(b.id));
            if (!labelsForBoard.length) return '';
            return `
              <div style="margin-bottom: 12px;">
                <div style="font-size:12px; color: var(--text-faint); margin-bottom: 6px;">${escapeHtml(b.title)}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                  ${labelsForBoard.map(l => `
                    <span class="label-chip on" style="--lc:${l.color}; position: relative;" data-label-id="${l.id}" data-board-id="${b.id}">
                      <span class="dot"></span>
                      <span>${escapeHtml(l.name)}</span>
                      <button type="button" class="label-del" data-del-label="${l.id}" title="Hapus label" style="background:none; border:none; color:var(--text-faint); cursor:pointer; margin-left:4px; font-size:14px; line-height:1;">×</button>
                    </span>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('') || '<div style="font-size:12px; color:var(--text-faint);">Belum ada label. Buat di atas.</div>'}
        </div>
      </div>

      ${isAdmin ? `
      <div class="settings-card" style="margin-top: 24px;">
        <h2>Manajemen Pengguna (Super Admin)</h2>
        <div id="users-error" class="auth-error hidden" style="color: var(--danger); background: rgba(239,68,68,0.08); padding: 10px 12px; border-radius: var(--r-md); font-size:12.5px; font-weight:600; margin-bottom: 16px; border: 1px solid rgba(239,68,68,0.18)"></div>

        <form id="admin-create-user-form" style="display:flex; gap: 8px; margin-bottom: 20px; align-items: flex-end;">
          <div class="field" style="margin-bottom:0; flex:1;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Username</label>
            <input id="ac-username" type="text" placeholder="Username baru" required style="width:100%; padding: 8px 12px; font-size:13px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;" />
          </div>
          <div class="field" style="margin-bottom:0; flex:1;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Password</label>
            <input id="ac-password" type="password" placeholder="Password" required style="width:100%; padding: 8px 12px; font-size:13px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); outline:none;" />
          </div>
          <div class="field" style="margin-bottom:0; width: 110px;">
            <label style="font-size:11px; margin-bottom:4px; display:block; color:var(--text-muted)">Role</label>
            <select id="ac-role" style="padding: 8px 12px; font-size:13px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); width:100%; outline:none;">
              <option value="user">Anggota</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="padding: 0 16px; font-size:13px; height: 36px; display:flex; align-items:center; justify-content:center;">+ Buat</button>
        </form>

        <div class="users-table-wrapper" style="overflow-x:auto;">
          <table class="users-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:13.5px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-strong); color:var(--text-muted); font-weight:700;">
                <th style="padding: 10px 12px;">Username</th>
                <th style="padding: 10px 12px;">Role</th>
                <th style="padding: 10px 12px;">Status</th>
                <th style="padding: 10px 12px; text-align:right;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${state.usersList.map(u => {
                const isSelf = u.username === state.user.username;
                const statusText = u.approved ? '<span style="color:var(--success);font-weight:600;">Aktif</span>' : '<span style="color:var(--warning);font-weight:600;">Pending</span>';
                const actionButton = isSelf ? '' : (
                  u.approved
                    ? `<button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px; border-color: rgba(245,158,11,0.2); color:var(--warning);" data-toggle-approve="${u.id}" data-approved="false">Suspen</button>`
                    : `<button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px; border-color: rgba(16,185,129,0.2); color:var(--success);" data-toggle-approve="${u.id}" data-approved="true">Setujui</button>`
                );
                const deleteButton = isSelf ? '' : `<button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px; border-color: rgba(239,68,68,0.2); color:var(--danger); margin-left: 4px;" data-delete-user="${u.id}">Hapus</button>`;
                return `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding: 10px 12px;"><strong>${escapeHtml(u.username)}</strong> ${isSelf ? '<small style="color:var(--text-faint)">(Anda)</small>' : ''}</td>
                    <td style="padding: 10px 12px;">${u.role === 'admin' ? 'Admin' : 'Anggota'}</td>
                    <td style="padding: 10px 12px;">${statusText}</td>
                    <td style="padding: 10px 12px; text-align:right;">
                      ${actionButton}
                      ${deleteButton}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      <div class="settings-card" style="margin-top: 24px;">
        <h2>💾 Backup & Restore</h2>
        <p style="font-size:12.5px; color:var(--text-muted); margin-top: -4px;">Export seluruh data ke file JSON, atau import dari backup. Data user (password) tidak ikut demi keamanan.</p>
        <div style="display:flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="btn-export" class="btn btn-primary" style="padding: 0 16px; font-size:13px; height: 36px;">⬇ Export JSON</button>
          <label class="btn btn-ghost" style="padding: 0 16px; font-size:13px; height: 36px; display:inline-flex; align-items:center; cursor:pointer;">
            ⬆ Import JSON
            <input id="file-import" type="file" accept="application/json" style="display:none;" />
          </label>
        </div>
        <div id="backup-msg" style="font-size:12px; color:var(--text-muted); margin-top: 8px;"></div>
      </div>

      <div class="settings-card" style="margin-top: 24px;">
        <h2>📚 Panduan & Fitur Aplikasi (FlowBoard)</h2>
        <div class="app-guide" style="font-size: 13.5px; line-height: 1.6; color: var(--text-muted); display: flex; flex-direction: column; gap: 16px;">
          <div class="guide-section">
            <h3 style="color: var(--text-strong); font-size: 14.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">🏷️ Label & Filter</h3>
            <p style="margin:0;">Buka menu <strong>Pengaturan</strong> untuk membuat label per papan (nama + warna). Buka kartu dan centang label yang relevan. Di papan, gunakan <strong>Filter Bar</strong> di atas kolom untuk menyaring kartu berdasarkan label, prioritas, atau tenggat.</p>
          </div>
          <div class="guide-section">
            <h3 style="color: var(--text-strong); font-size: 14.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">🔁 Pengulangan Otomatis</h3>
            <p style="margin:0;">Buka kartu → expand <strong>Pengulangan Otomatis</strong>. Pilih harian / mingguan / bulanan, set due date, dan sistem akan otomatis spawn kartu baru saat due tiba. Label & warna template diwariskan ke occurrence.</p>
          </div>
          <div class="guide-section">
            <h3 style="color: var(--text-strong); font-size: 14.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">📜 Riwayat Aktivitas</h3>
            <p style="margin:0;">Setiap perubahan kartu (judul, due, status, perpindahan kolom) tercatat otomatis. Buka kartu → scroll ke bawah untuk melihat log siapa ngapain kapan.</p>
          </div>
          <div class="guide-section">
            <h3 style="color: var(--text-strong); font-size: 14.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">🗂️ Kanban & Struktur WBS (Parent-Child)</h3>
            <p style="margin:0;">Buat <strong>Pekerjaan Induk</strong> dari tombol kolom, lalu klik kartu untuk membuka modal dan klik <strong>+ Subtask</strong>. Progres subtask (seperti 1/3 selesai) otomatis terhitung.</p>
          </div>
          <div class="guide-section">
            <h3 style="color: var(--text-strong); font-size: 14.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">🔒 Pendaftaran & Approval Akun</h3>
            <p style="margin:0;">Akun baru berstatus <strong>Pending</strong>. Super Admin wajib menyetujui dari menu Pengaturan.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-logout').onclick = () => {
    localStorage.removeItem('flowboard-user');
    state.user = null;
    boot();
  };

  // Label creation
  container.querySelector('#label-create-form').onsubmit = async (e) => {
    e.preventDefault();
    const boardId = Number(container.querySelector('#lc-board').value);
    const name = container.querySelector('#lc-name').value.trim();
    const color = container.querySelector('#lc-color').value;
    if (!name) return;
    try {
      const created = await api.createLabel(boardId, name, color);
      // Add to local state
      const existing = state.labels.find(l => Number(l.board_id) === Number(boardId) && l.name === created.name);
      if (!existing) state.labels.push(created);
      // Switch to that board to make label visible
      state.activeBoardId = boardId;
      await loadActiveBoard();
      renderContent();
      renderSettings(container);
    } catch (err) {
      alert('Gagal membuat label: ' + err.message);
    }
  };

  // Delete label
  container.querySelectorAll('[data-del-label]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.delLabel);
      if (!confirm('Hapus label ini? Kartu yang punya label ini akan kehilangan labelnya.')) return;
      try {
        await api.deleteLabel(id);
        state.labels = state.labels.filter(l => Number(l.id) !== id);
        // Clean card labels cache
        for (const key of Object.keys(state.cardLabelsMap)) {
          state.cardLabelsMap[key] = state.cardLabelsMap[key].filter(l => Number(l.id) !== id);
        }
        renderContent();
        renderSettings(container);
      } catch (err) {
        alert('Gagal: ' + err.message);
      }
    };
  });

  // Export / Import
  const backupMsg = container.querySelector('#backup-msg');
  container.querySelector('#btn-export').onclick = async () => {
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flowboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      backupMsg.textContent = `✓ Export sukses: ${data.boards.length} papan, ${data.cards.length} kartu, ${data.labels.length} label.`;
    } catch (err) {
      backupMsg.textContent = '✗ Gagal export: ' + err.message;
    }
  };
  container.querySelector('#file-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Import akan menimpa data yang ada. Lanjutkan?')) { e.target.value = ''; return; }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await api.importAll(payload);
      backupMsg.textContent = `✓ Import sukses: ${JSON.stringify(res.counts)}`;
      await loadActiveBoard();
      renderSettings(container);
    } catch (err) {
      backupMsg.textContent = '✗ Gagal import: ' + err.message;
    }
    e.target.value = '';
  };

  if (isAdmin) {
    const errorEl = container.querySelector('#users-error');
    container.querySelector('#admin-create-user-form').onsubmit = async (e) => {
      e.preventDefault();
      errorEl.classList.add('hidden');
      const uEl = container.querySelector('#ac-username');
      const pEl = container.querySelector('#ac-password');
      const rEl = container.querySelector('#ac-role');
      try {
        await api.createUser(uEl.value.trim(), pEl.value, rEl.value);
        uEl.value = '';
        pEl.value = '';
        state.usersList = await api.getUsers();
        renderSettings(container);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    };
    container.querySelectorAll('[data-toggle-approve]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.toggleApprove);
        const approved = btn.dataset.approved === 'true';
        try {
          await api.approveUser(id, approved);
          state.usersList = await api.getUsers();
          renderSettings(container);
        } catch (err) {
          alert('Gagal mengubah status: ' + err.message);
        }
      };
    });
    container.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.deleteUser);
        if (confirm('Hapus pengguna ini secara permanen?')) {
          try {
            await api.deleteUser(id);
            state.usersList = await api.getUsers();
            renderSettings(container);
          } catch (err) {
            alert('Gagal menghapus pengguna: ' + err.message);
          }
        }
      };
    });
  }
}

boot();
