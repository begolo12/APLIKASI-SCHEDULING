// Calendar month view: renders cards by due date.
import { escapeHtml } from '../utils.js';

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

let viewYear, viewMonth;

export function renderCalendar(container, cards, onEventClick) {
  const today = new Date();
  if (viewYear === undefined) { viewYear = today.getFullYear(); viewMonth = today.getMonth(); }

  const first = new Date(viewYear, viewMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysPrev = new Date(viewYear, viewMonth, 0).getDate();

  // Group cards by yyyy-mm-dd
  const byDate = {};
  for (const c of cards) {
    if (!c.due_at) continue;
    const d = new Date(c.due_at);
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (byDate[key] = byDate[key] || []).push(c);
  }

  const cells = [];
  for (let i = 0; i < startDay; i++) {
    cells.push({ day: daysPrev - startDay + i + 1, other: true, month: viewMonth - 1 });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false, month: viewMonth });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - (startDay + daysInMonth) + 1, other: true, month: viewMonth + 1 });

  const isToday = (day, other) => !other && day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();

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
        const key = `${viewYear}-${cell.month}-${cell.day}`;
        const evts = byDate[key] || [];
        return `
          <div class="cal-cell ${cell.other ? 'other' : ''} ${isToday(cell.day, cell.other) ? 'today' : ''}">
            <div class="cal-date">${cell.day}</div>
            ${evts.slice(0, 4).map(c => `
              <div class="cal-event" data-id="${c.id}" style="background:${c.color || 'var(--accent)'};${c.completed ? 'opacity:0.5;text-decoration:line-through;' : ''}">
                ${escapeHtml(c.title)}
              </div>`).join('')}
            ${evts.length > 4 ? `<div class="cal-date" style="font-size:11px">+${evts.length - 4} lagi</div>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;

  container.querySelector('#cal-prev').onclick = () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCalendar(container, cards, onEventClick); };
  container.querySelector('#cal-next').onclick = () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCalendar(container, cards, onEventClick); };
  container.querySelector('#cal-today').onclick = () => { viewYear = today.getFullYear(); viewMonth = today.getMonth(); renderCalendar(container, cards, onEventClick); };

  container.querySelectorAll('.cal-event').forEach(el => {
    el.onclick = () => onEventClick(Number(el.dataset.id));
  });
}
