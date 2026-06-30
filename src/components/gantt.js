import { escapeHtml } from '../utils.js';

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

let viewYear, viewMonth;
let zoomMode = 'day'; // 'day' | 'month'

export function renderGantt(container, cards, onEventClick, onUpdateCard) {
  const today = new Date();
  if (viewYear === undefined) {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
  }

  const startOfMonth = new Date(viewYear, viewMonth, 1);
  const endOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const daysInMonth = endOfMonth.getDate();

  // Create columns based on zoom mode
  const cols = [];
  const colCount = zoomMode === 'day' ? daysInMonth : 12;

  if (zoomMode === 'day') {
    for (let d = 1; d <= daysInMonth; d++) {
      const curDate = new Date(viewYear, viewMonth, d);
      const dayOfWeek = curDate.getDay();
      cols.push({
        label: DOW[dayOfWeek],
        sublabel: String(d),
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isToday: d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()
      });
    }
  } else {
    for (let m = 0; m < 12; m++) {
      cols.push({
        label: MONTHS[m].slice(0, 3),
        sublabel: '',
        isWeekend: false,
        isToday: m === today.getMonth() && viewYear === today.getFullYear()
      });
    }
  }

  // Format Gantt container
  container.innerHTML = `
    <div class="gantt-header">
      <h2>Timeline: ${zoomMode === 'day' ? `${MONTHS[viewMonth]} ${viewYear}` : `Tahun ${viewYear}`}</h2>
      <div class="gantt-controls">
        <select id="gantt-zoom" style="background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px; color: var(--text); font-size: 13px; font-weight: 600; outline: none; margin-right: 8px;">
          <option value="day" ${zoomMode === 'day' ? 'selected' : ''}>Harian</option>
          <option value="month" ${zoomMode === 'month' ? 'selected' : ''}>Bulanan</option>
        </select>
        <button id="gantt-prev" title="Sebelumnya">‹</button>
        <button id="gantt-today" title="Hari ini">Hari ini</button>
        <button id="gantt-next" title="Berikutnya">›</button>
      </div>
    </div>
    <div class="gantt-container" id="gantt-container">
      <div class="gantt-grid-header">
        <div class="gantt-grid-header-label">Nama Kartu</div>
        <div class="gantt-grid-days" style="grid-template-columns: repeat(${colCount}, 1fr)">
          ${cols.map(c => `
            <div class="gantt-day-col ${c.isWeekend ? 'weekend' : ''} ${c.isToday ? 'today' : ''}">
              <div>${c.label}</div>
              ${c.sublabel ? `<div style="font-weight: 800; font-size: 13px; margin-top: 2px;">${c.sublabel}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>
      <div class="gantt-bg-days" style="grid-template-columns: repeat(${colCount}, 1fr)">
        ${cols.map(c => `<div class="gantt-bg-day ${c.isWeekend ? 'weekend' : ''} ${c.isToday ? 'today' : ''}"></div>`).join('')}
      </div>
      <div class="gantt-rows" id="gantt-rows-list">
        ${cards.length === 0 ? '<div class="empty-hint">Belum ada kartu di papan ini</div>' : ''}
      </div>
    </div>
  `;

  // Zoom handler
  container.querySelector('#gantt-zoom').onchange = (e) => {
    zoomMode = e.target.value;
    renderGantt(container, cards, onEventClick, onUpdateCard);
  };

  // Navigation handlers
  container.querySelector('#gantt-prev').onclick = () => {
    if (zoomMode === 'day') {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    } else {
      viewYear--;
    }
    renderGantt(container, cards, onEventClick, onUpdateCard);
  };
  container.querySelector('#gantt-next').onclick = () => {
    if (zoomMode === 'day') {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    } else {
      viewYear++;
    }
    renderGantt(container, cards, onEventClick, onUpdateCard);
  };
  container.querySelector('#gantt-today').onclick = () => {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    renderGantt(container, cards, onEventClick, onUpdateCard);
  };

  const rowsContainer = container.querySelector('#gantt-rows-list');
  if (cards.length === 0) return;

  // Sort cards hierarchically
  const roots = [];
  const childrenMap = {};

  cards.forEach(card => {
    if (card.parent_id) {
      const parentExists = cards.some(c => String(c.id) === String(card.parent_id));
      if (parentExists) {
        (childrenMap[String(card.parent_id)] = childrenMap[String(card.parent_id)] || []).push(card);
        return;
      }
    }
    roots.push(card);
  });

  const dateSorter = (a, b) => {
    const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
    const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.position - b.position;
  };

  roots.sort(dateSorter);

  const orderedCards = [];
  roots.forEach((root, rootIndex) => {
    const rootNo = `${rootIndex + 1}`;
    orderedCards.push({ card: root, isSub: false, no: rootNo });
    const children = childrenMap[String(root.id)] || [];
    children.sort(dateSorter);
    children.forEach((child, childIndex) => {
      orderedCards.push({ card: child, isSub: true, no: `${rootNo}.${childIndex + 1}` });
    });
  });

  // Helper to determine if a card overlaps with the current month/year view range
  const overlapsView = (card) => {
    let startVal = card.start_at ? new Date(card.start_at) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let dueVal = card.due_at ? new Date(card.due_at) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (zoomMode === 'day') {
      const itemStartMs = startVal.getTime();
      const itemDueMs = dueVal.getTime();
      const monthStartMs = startOfMonth.getTime();
      const monthEndMs = endOfMonth.getTime();
      return itemStartMs <= monthEndMs && itemDueMs >= monthStartMs;
    } else {
      return startVal.getFullYear() <= viewYear && dueVal.getFullYear() >= viewYear;
    }
  };

  // Determine which cards should have their rows rendered
  const visibleCardIds = new Set();
  
  // First pass: direct overlap
  cards.forEach(card => {
    if (overlapsView(card)) {
      visibleCardIds.add(String(card.id));
    }
  });

  // Second pass: include parent cards recursively if they have visible subtasks
  let addedParent = true;
  while (addedParent) {
    addedParent = false;
    cards.forEach(card => {
      if (visibleCardIds.has(String(card.id)) && card.parent_id) {
        const pIdStr = String(card.parent_id);
        if (!visibleCardIds.has(pIdStr)) {
          visibleCardIds.add(pIdStr);
          addedParent = true;
        }
      }
    });
  }

  // Filter ordered cards to only those that should be visible
  const renderedCards = orderedCards.filter(item => visibleCardIds.has(String(item.card.id)));

  renderedCards.forEach(({ card, isSub, no }) => {
    // Determine card dates or default to auto-scheduled today-tomorrow
    let hasDates = card.start_at && card.due_at;
    let startVal = card.start_at ? new Date(card.start_at) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let dueVal = card.due_at ? new Date(card.due_at) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const isOutOfRange = !overlapsView(card);

    // Calculate grid placement
    let colStart = 1;
    let colEnd = colCount + 1;
    let marginLeft = '0%';
    let marginRight = '0%';

    if (!isOutOfRange) {
      if (zoomMode === 'day') {
        colStart = startVal.getFullYear() === viewYear && startVal.getMonth() === viewMonth ? startVal.getDate() : 1;
        colEnd = dueVal.getFullYear() === viewYear && dueVal.getMonth() === viewMonth ? dueVal.getDate() + 1 : colCount + 1;
      } else {
        colStart = startVal.getFullYear() === viewYear ? startVal.getMonth() + 1 : 1;
        colEnd = dueVal.getFullYear() === viewYear ? dueVal.getMonth() + 2 : colCount + 1;
      }

      if (colStart > colCount) colStart = colCount;
      if (colEnd <= colStart) colEnd = colStart + 1;

      if (zoomMode === 'month' && hasDates) {
        const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
        const daysInStartMonth = getDaysInMonth(startVal.getFullYear(), startVal.getMonth());
        const daysInDueMonth = getDaysInMonth(dueVal.getFullYear(), dueVal.getMonth());

        const f1 = (startVal.getDate() - 1) / daysInStartMonth;
        const f2 = dueVal.getDate() / daysInDueMonth;
        const N = colEnd - colStart;

        marginLeft = `${((f1 / N) * 100).toFixed(2)}%`;
        marginRight = `${(((1 - f2) / N) * 100).toFixed(2)}%`;
      }
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'gantt-row';
    rowEl.innerHTML = `
      <div class="gantt-row-label" title="${escapeHtml(card.title)}" style="${isSub ? 'padding-left: 36px; font-weight: 500;' : ''}">
        <span style="display:inline-block; min-width:32px; color: var(--text-faint); font-variant-numeric: tabular-nums;">${no}</span>
        ${isSub ? '<span style="color: var(--text-faint); margin-right: 6px;">↳</span>' : ''}
        ${escapeHtml(card.title)}
      </div>
      <div class="gantt-row-track" style="grid-template-columns: repeat(${colCount}, 1fr)">
        ${isOutOfRange ? '' : `
        <div class="gantt-bar ${card.completed ? 'completed' : ''} ${!hasDates ? 'unscheduled' : ''}" 
             data-id="${card.id}" 
             title="${escapeHtml(card.title)} (${hasDates ? `${startVal.toLocaleDateString('id-ID')} - ${dueVal.toLocaleDateString('id-ID')}` : 'Belum dijadwalkan'})"
             style="grid-column: ${colStart} / ${colEnd}; margin-left: ${marginLeft}; margin-right: ${marginRight}; background: ${card.color || 'var(--accent)'}; opacity: ${!hasDates ? '0.75' : '1'}; border: ${!hasDates ? '2px dashed rgba(255,255,255,0.6)' : 'none'}; cursor: ${zoomMode === 'day' ? 'grab' : 'pointer'}">
          ${zoomMode === 'day' ? '<div class="gantt-bar-handle gantt-bar-handle-left"></div>' : ''}
          <span class="gantt-bar-title">${no}. ${escapeHtml(card.title)}</span>
          ${zoomMode === 'day' ? '<div class="gantt-bar-handle gantt-bar-handle-right"></div>' : ''}
        </div>
        `}
      </div>
    `;

    // Click to open card details modal
    let hasDragged = false;
    const barEl = rowEl.querySelector('.gantt-bar');
    if (barEl) {
      barEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('gantt-bar-handle')) return; // ignore handle clicks
        if (hasDragged) {
          hasDragged = false;
          return;
        }
        onEventClick(card.id);
      });

      if (zoomMode === 'day') {
        // Drag-to-shift and resize implementation
        let isDragging = false;
        let dragType = ''; // 'move' | 'left' | 'right'
        let initialX = 0;
        let initialColStart = colStart;
        let initialColEnd = colEnd;
        let dayWidth = 0;

        const onMouseDown = (e) => {
          e.preventDefault();
          e.stopPropagation();

          const containerRect = container.querySelector('.gantt-grid-days').getBoundingClientRect();
          dayWidth = containerRect.width / daysInMonth;

          isDragging = true;
          initialX = e.clientX;
          initialColStart = colStart;
          initialColEnd = colEnd;
          hasDragged = false;

          if (e.target.classList.contains('gantt-bar-handle-left')) {
            dragType = 'left';
          } else if (e.target.classList.contains('gantt-bar-handle-right')) {
            dragType = 'right';
          } else {
            dragType = 'move';
          }

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
          if (!isDragging) return;

          const deltaX = e.clientX - initialX;
          if (Math.abs(deltaX) > 2) {
            hasDragged = true;
          }
          const deltaDays = Math.round(deltaX / dayWidth);

          let newStart = colStart;
          let newEnd = colEnd;

          if (dragType === 'move') {
            newStart = Math.max(1, Math.min(daysInMonth, initialColStart + deltaDays));
            newEnd = Math.max(2, Math.min(daysInMonth + 1, initialColEnd + deltaDays));
            // Keep duration constant
            const duration = initialColEnd - initialColStart;
            if (newStart + duration <= daysInMonth + 1) {
              newEnd = newStart + duration;
            } else {
              newStart = daysInMonth + 1 - duration;
              newEnd = daysInMonth + 1;
            }
          } else if (dragType === 'left') {
            newStart = Math.max(1, Math.min(initialColEnd - 1, initialColStart + deltaDays));
          } else if (dragType === 'right') {
            newEnd = Math.max(initialColStart + 1, Math.min(daysInMonth + 1, initialColEnd + deltaDays));
          }

          barEl.style.gridColumn = `${newStart} / ${newEnd}`;
        };

        const onMouseUp = () => {
          if (!isDragging) return;
          isDragging = false;
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);

          // Extract new column offsets
          const colSplit = barEl.style.gridColumn.split('/');
          const finalStart = parseInt(colSplit[0]);
          const finalEnd = parseInt(colSplit[1]) - 1; // subtract 1 since grid-column-end is non-inclusive

          // Calculate final target dates
          const newStartDate = new Date(viewYear, viewMonth, finalStart, 9, 0, 0); // Default to 9:00 AM local
          const newEndDate = new Date(viewYear, viewMonth, finalEnd, 17, 0, 0); // Default to 5:00 PM local

          onUpdateCard(card.id, newStartDate.toISOString(), newEndDate.toISOString());
        };

        barEl.addEventListener('mousedown', onMouseDown);
      }
    }

    rowsContainer.appendChild(rowEl);
  });
}
