// Calendar month view: renders cards by due date.
import { escapeHtml } from '../utils.js';

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
let viewYear, viewMonth;

export function renderCalendar(container, cards, onEventClick, onEventMove) {
  const today = new Date();
  if (viewYear === undefined) { viewYear = today.getFullYear(); viewMonth = today.getMonth(); }
  const first = new Date(viewYear, viewMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysPrev = new Date(viewYear, viewMonth, 0).getDate();

  const byDate = {};
  const parentIds = new Set(cards.filter(c => c.parent_id).map(c => String(c.parent_id)));

  for (const c of cards) {
    if (parentIds.has(String(c.id))) continue; // Skip parent cards
    if (!c.due_at) continue;
    const due = new Date(c.due_at);
    if (isNaN(due)) continue;

    const hasStart = c.start_at && !isNaN(new Date(c.start_at));
    if (!hasStart) {
      // Single day task
      const key = `${due.getFullYear()}-${due.getMonth()}-${due.getDate()}`;
      (byDate[key] = byDate[key] || []).push({
        card: c,
        labelText: escapeHtml(c.title)
      });
      continue;
    }

    const start = new Date(c.start_at);
    const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (startMidnight.getTime() > dueMidnight.getTime()) {
      // Fallback if dates are inverted
      const key = `${due.getFullYear()}-${due.getMonth()}-${due.getDate()}`;
      (byDate[key] = byDate[key] || []).push({
        card: c,
        labelText: escapeHtml(c.title)
      });
      continue;
    }

    const totalDays = Math.round((dueMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (totalDays === 1) {
      // 1-day duration task
      const key = `${due.getFullYear()}-${due.getMonth()}-${due.getDate()}`;
      (byDate[key] = byDate[key] || []).push({
        card: c,
        labelText: escapeHtml(c.title)
      });
      continue;
    }

    let current = new Date(startMidnight);
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const key = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
      const dayLabel = dayNum === totalDays ? `(Day ${dayNum} - End)` : `(Day ${dayNum})`;
      (byDate[key] = byDate[key] || []).push({
        card: c,
        labelText: `${dayLabel} ${escapeHtml(c.title)}`
      });
      current.setDate(current.getDate() + 1);
    }
  }

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push({ day: daysPrev - startDay + i + 1, other: true, month: viewMonth - 1 });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false, month: viewMonth });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - (startDay + daysInMonth) + 1, other: true, month: viewMonth + 1 });

  const fullDate = (cell) => new Date(viewYear, cell.month, cell.day);
  const dateKey = (cell) => {
    const d = fullDate(cell);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const isToday = (cell) => {
    const d = fullDate(cell);
    return d.toDateString() === today.toDateString();
  };

  container.innerHTML = `
    <div class="cal-header">
      <h2>${MONTHS[viewMonth]} ${viewYear}</h2>
      <div class="cal-nav">
        <button id="cal-prev" title="Bulan sebelumnya">‹</button>
        <button id="cal-today" title="Hari ini" style="width:auto;padding:0 14px;font-size:13px;font-weight:600;">Hari ini</button>
        <button id="cal-next" title="Bulan berikutnya">›</button>
      </div>
    </div>
    <div class="cal-grid">
      ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells.map(cell => {
        const key = dateKey(cell);
        const evts = byDate[key] || [];
        const d = fullDate(cell);
        const isoDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return `
          <div class="cal-cell ${cell.other ? 'other' : ''} ${isToday(cell) ? 'today' : ''}" data-date="${isoDay}">
            <div class="cal-date">${cell.day}</div>
            ${evts.slice(0, 3).map(evt => `
              <div class="cal-event" draggable="true" data-id="${evt.card.id}" style="background:${evt.card.color || 'var(--accent)'};${evt.card.completed ? 'opacity:0.5;text-decoration:line-through;' : ''}">${evt.labelText}</div>`).join('')}
            ${evts.length > 3 ? `<div class="cal-more" data-date="${isoDay}">+${evts.length - 3} lagi</div>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;

  container.querySelector('#cal-prev').onclick = () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCalendar(container, cards, onEventClick, onEventMove); };
  container.querySelector('#cal-next').onclick = () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCalendar(container, cards, onEventClick, onEventMove); };
  container.querySelector('#cal-today').onclick = () => { viewYear = today.getFullYear(); viewMonth = today.getMonth(); renderCalendar(container, cards, onEventClick, onEventMove); };
  container.querySelectorAll('.cal-event').forEach(el => {
    el.onclick = () => onEventClick(Number(el.dataset.id));
    el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', el.dataset.id); };
  });
  container.querySelectorAll('.cal-more').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      openDailyEventsModal(el.dataset.date, cards, onEventClick);
    };
  });
  container.querySelectorAll('.cal-cell').forEach(cell => {
    cell.onclick = (e) => {
      if (e.target.closest('.cal-event') || e.target.closest('.cal-more')) return;
      openDailyEventsModal(cell.dataset.date, cards, onEventClick);
    };
    cell.ondragover = (e) => e.preventDefault();
    cell.ondrop = async (e) => {
      e.preventDefault();
      const cardId = Number(e.dataTransfer.getData('text/plain'));
      if (!cardId || typeof onEventMove !== 'function') return;
      await onEventMove(cardId, cell.dataset.date);
    };
  });
}

function openDailyEventsModal(dateStr, cards, onEventClick) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const today = new Date();
  const targetDate = new Date(y, m - 1, d);
  const formattedDate = targetDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const parentIds = new Set(cards.filter(c => c.parent_id).map(c => String(c.parent_id)));
  const dailyCards = [];
  for (const c of cards) {
    if (parentIds.has(String(c.id))) continue; // Skip parent cards
    if (!c.due_at) continue;
    const due = new Date(c.due_at);
    if (isNaN(due)) continue;

    const hasStart = c.start_at && !isNaN(new Date(c.start_at));
    if (!hasStart) {
      if (due.getFullYear() === y && due.getMonth() === (m - 1) && due.getDate() === d) {
        dailyCards.push({
          card: c,
          labelText: c.title
        });
      }
      continue;
    }

    const start = new Date(c.start_at);
    const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    if (startMidnight.getTime() > dueMidnight.getTime()) {
      if (due.getFullYear() === y && due.getMonth() === (m - 1) && due.getDate() === d) {
        dailyCards.push({
          card: c,
          labelText: c.title
        });
      }
      continue;
    }

    const totalDays = Math.round((dueMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    let current = new Date(startMidnight);
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      if (current.getFullYear() === y && current.getMonth() === (m - 1) && current.getDate() === d) {
        const dayLabel = dayNum === totalDays ? `(Day ${dayNum} - End)` : `(Day ${dayNum})`;
        dailyCards.push({
          card: c,
          labelText: `${dayLabel} ${c.title}`
        });
      }
      current.setDate(current.getDate() + 1);
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1000';

  overlay.innerHTML = `
    <div class="modal" style="width: 440px; display: flex; flex-direction: column; max-height: 70vh;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
        <h3 style="margin:0; font-size:16px; color:var(--text-strong); font-weight:700;">Daftar Tugas</h3>
        <button id="close-daily-modal" style="background:none; border:none; color:var(--text-faint); font-size:20px; cursor:pointer;">&times;</button>
      </div>
      <div style="font-size:12.5px; color:var(--text-muted); margin-bottom: 16px; font-weight: 600;">⏰ ${formattedDate}</div>
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;" id="daily-events-list">
        ${dailyCards.map(evt => `
          <div class="cal-event-item" data-id="${evt.card.id}" style="--lc:${evt.card.color || 'var(--accent)'}; border-left: 4px solid ${evt.card.color || 'var(--accent)'};">
            ${escapeHtml(evt.labelText)}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#close-daily-modal');
  closeBtn.onclick = () => overlay.remove();

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.querySelectorAll('.cal-event-item').forEach(item => {
    item.onclick = () => {
      const cardId = Number(item.dataset.id);
      overlay.remove();
      onEventClick(cardId);
    };
  });
}
