import './styles/app.css';
import Sortable from 'sortablejs';
import api from './api.js';
import { dueInfo, escapeHtml } from './utils.js';
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
  view: 'board', // 'board' | 'calendar' | 'gantt' | 'settings'
  search: '',
  dbMode: 'local',
  saveStatus: 'saved',
  saveError: '',
  user: savedUser ? JSON.parse(savedUser) : null,
  usersList: []
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
          ${state.dbMode === 'neon' ? 'Neon Postgres' : (state.dbMode === 'mock' ? 'Preview (browser)' : 'Penyimpanan lokal')}
        </div>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  if (state.view === 'settings') {
    return `
      <header class="topbar">
        <h1>Pengaturan Aplikasi</h1>
      </header>
    `;
  }
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
  if (state.view === 'settings') {
    content.className = 'settings-wrap';
    renderSettings(content);
    return;
  }
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

  const settingsEl = document.getElementById('nav-settings');
  if (settingsEl) {
    settingsEl.onclick = async () => {
      state.view = 'settings';
      if (state.user.role === 'admin') {
        state.usersList = await api.getUsers();
      }
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

  if (!state.user) {
    renderLogin();
    return;
  }

  await loadBoards();
  await loadActiveBoard();
  render();
  startReminderLoop();
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
  let mode = 'login'; // 'login' | 'register'
  const form = document.getElementById('auth-form');
  const titleEl = document.getElementById('auth-title');
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');
  const toggleLink = document.getElementById('auth-toggle-link');
  const switchEl = document.querySelector('.auth-switch');

  toggleLink.onclick = (e) => {
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
    bindAuthEvents(); // rebind toggle
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
    </div>
  `;

  // Bind settings page buttons
  container.querySelector('#btn-logout').onclick = () => {
    localStorage.removeItem('flowboard-user');
    state.user = null;
    boot();
  };

  if (isAdmin) {
    const errorEl = container.querySelector('#users-error');
    
    // Create user
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
        renderContent();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    };

    // Toggle approval
    container.querySelectorAll('[data-toggle-approve]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.toggleApprove);
        const approved = btn.dataset.approved === 'true';
        try {
          await api.approveUser(id, approved);
          state.usersList = await api.getUsers();
          renderContent();
        } catch (err) {
          alert('Gagal mengubah status: ' + err.message);
        }
      };
    });

    // Delete user
    container.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.deleteUser);
        if (confirm('Hapus pengguna ini secara permanen?')) {
          try {
            await api.deleteUser(id);
            state.usersList = await api.getUsers();
            renderContent();
          } catch (err) {
            alert('Gagal menghapus pengguna: ' + err.message);
          }
        }
      };
    });
  }
}

boot();
