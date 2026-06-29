// Card detail modal: edit all card fields including labels, recurring rule, and history.
import { LABEL_COLORS, DAY_LABELS_ID, toLocalInput, fromLocalInput, escapeHtml, describeAction, timeAgo, describeRule } from '../utils.js';

let overlayEl = null;

export async function openCardModal(card, { cards = [], labels = [], cardLabels = [], history = [], boardId, onCreateSubtask, onSave, onDelete, onLabelsChange, onCreateLabel, onDeleteLabel, onRefreshHistory }) {
  closeCardModal();

  let selectedColor = card.color || null;
  let selectedLabelIds = new Set((cardLabels || []).map(l => Number(l.id)));

  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.innerHTML = `
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <input id="cm-title" class="modal-title-input" value="${escapeHtml(card.title)}" placeholder="Judul kartu" />

      <div class="field">
        <label for="cm-desc">Deskripsi</label>
        <textarea id="cm-desc" placeholder="Tambahkan detail...">${escapeHtml(card.description || '')}</textarea>
      </div>

      <div class="field">
        <label for="cm-parent">Pekerjaan Induk (Parent Task)</label>
        <select id="cm-parent" style="width: 100%; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 11px 13px; color: var(--text); font-size: 14px; outline: none; transition: all 0.16s var(--ease);">
          <option value="">— Tanpa Induk (Mandiri) —</option>
          ${cards
            .filter(c => c.id !== card.id && !c.parent_id && c.parent_id !== card.id)
            .map(c => `<option value="${c.id}" ${card.parent_id === c.id ? 'selected' : ''}>${escapeHtml(c.title)}</option>`)
            .join('')}
        </select>
      </div>

      <div class="field">
        <label for="cm-priority">Prioritas Pekerjaan</label>
        <select id="cm-priority" style="width: 100%; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 11px 13px; color: var(--text); font-size: 14px; outline: none; transition: all 0.16s var(--ease);">
          <option value="rendah" ${card.priority === 'rendah' ? 'selected' : ''}>🟢 Rendah (Low)</option>
          <option value="biasa" ${!card.priority || card.priority === 'biasa' ? 'selected' : ''}>🟡 Biasa (Medium)</option>
          <option value="tinggi" ${card.priority === 'tinggi' ? 'selected' : ''}>🔴 Tinggi (High)</option>
        </select>
      </div>

      <div class="field">
        <label for="cm-start">Tanggal Mulai</label>
        <input id="cm-start" type="datetime-local" value="${toLocalInput(card.start_at)}" />
      </div>

      <div class="field">
        <label for="cm-due">Tenggat Waktu</label>
        <input id="cm-due" type="datetime-local" value="${toLocalInput(card.due_at)}" />
      </div>

      <div class="field">
        <label for="cm-reminder">Pengingat</label>
        <select id="cm-reminder" style="width: 100%; background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 11px 13px; color: var(--text); font-size: 14px; outline: none; transition: all 0.16s var(--ease);">
          <option value="0" ${!card.reminder_minutes ? 'selected' : ''}>Saat jatuh tempo</option>
          <option value="5" ${Number(card.reminder_minutes) === 5 ? 'selected' : ''}>5 menit sebelum</option>
          <option value="10" ${Number(card.reminder_minutes) === 10 ? 'selected' : ''}>10 menit sebelum</option>
          <option value="30" ${Number(card.reminder_minutes) === 30 ? 'selected' : ''}>30 menit sebelum</option>
        </select>
      </div>

      <div class="field">
        <label>Label Warna</label>
        <div class="color-row" id="cm-colors">
          ${LABEL_COLORS.map(c => `<div class="color-dot ${selectedColor === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
          <div class="color-dot ${!selectedColor ? 'selected' : ''}" data-color="" style="background:var(--bg-elevated)" title="Tanpa warna">∅</div>
        </div>
      </div>

      <div class="field">
        <label>Label / Tag</label>
        <div class="label-picker" id="cm-labels">
          ${(labels || []).map(l => `
            <button type="button" class="label-chip ${selectedLabelIds.has(Number(l.id)) ? 'on' : ''}" data-label-id="${l.id}" style="--lc:${l.color}">
              <span class="dot"></span>
              <span>${escapeHtml(l.name)}</span>
            </button>
          `).join('')}
          ${(!labels || !labels.length) ? '<div style="font-size:12px; color:var(--text-faint); padding: 4px 0;">Belum ada label. Buat di panel Label.</div>' : ''}
        </div>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <input id="cm-newlabel-name" type="text" placeholder="Nama label baru" style="flex:1; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:6px 10px; color:var(--text); font-size:12px; outline:none;" />
          <input id="cm-newlabel-color" type="color" value="#6366f1" style="width:34px; height:30px; padding:0; border:1px solid var(--border); border-radius:var(--r-sm); background:transparent; cursor:pointer;" />
          <button type="button" id="cm-newlabel-add" class="btn btn-ghost" style="padding:0 12px; font-size:12px; height:30px;">+ Buat</button>
        </div>
      </div>

      <details class="recurring-block" id="cm-recurring-wrap" style="margin-top: 8px; background: var(--bg-surface-2); border:1px solid var(--border); border-radius: var(--r-md); padding: 10px 14px;">
        <summary style="cursor:pointer; font-weight:600; font-size:13px; color: var(--text);">🔁 Pengulangan Otomatis</summary>
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">
          <select id="cm-rule-kind" style="background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:8px 10px; color:var(--text); font-size:13px; outline:none;">
            <option value="none" ${(card.rule_kind || 'none') === 'none' ? 'selected' : ''}>Tidak berulang</option>
            <option value="daily" ${card.rule_kind === 'daily' ? 'selected' : ''}>Setiap hari</option>
            <option value="weekly" ${card.rule_kind === 'weekly' ? 'selected' : ''}>Mingguan (pilih hari)</option>
            <option value="monthly" ${card.rule_kind === 'monthly' ? 'selected' : ''}>Bulanan (tanggal tertentu)</option>
          </select>
          <div id="cm-rule-weekly" style="display:${card.rule_kind === 'weekly' ? 'flex' : 'none'}; flex-wrap:wrap; gap:6px;">
            ${DAY_LABELS_ID.map((name, i) => `
              <label class="dow-toggle" style="display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:4px 8px; border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer;">
                <input type="checkbox" data-dow="${i}" ${(Array.isArray(card.rule_dow) && card.rule_dow.includes(i)) ? 'checked' : ''} />
                ${name}
              </label>
            `).join('')}
          </div>
          <div id="cm-rule-monthly" style="display:${card.rule_kind === 'monthly' ? 'flex' : 'none'}; align-items:center; gap:8px;">
            <label style="font-size:12px; color:var(--text-muted);">Tanggal:</label>
            <input id="cm-rule-dom" type="number" min="1" max="31" value="${Number(card.rule_dom) || 1}" style="width:64px; background:var(--bg-surface-2); border:1px solid var(--border); border-radius:var(--r-sm); padding:6px 8px; color:var(--text); font-size:13px; outline:none;" />
            <span style="font-size:11px; color:var(--text-faint);">(1–31)</span>
          </div>
          <div style="font-size:11px; color: var(--text-faint);">Occurrence baru otomatis dibuat saat due date tiba, membawa label & warna yang sama.</div>
        </div>
      </details>

      <label class="toggle-done" for="cm-done">
        <input id="cm-done" type="checkbox" ${card.completed ? 'checked' : ''} />
        Tandai selesai
      </label>

      <div class="modal-section">
        <div class="section-title">📜 Riwayat Aktivitas</div>
        <div class="history-list" id="cm-history">
          ${renderHistory(history)}
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost" id="cm-subtask">+ Subtask</button>
        <button class="btn btn-primary" id="cm-save">Simpan</button>
        <button class="btn btn-ghost" id="cm-cancel">Batal</button>
        <button class="btn-danger-text" id="cm-delete">Hapus kartu</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayEl);

  const titleEl = overlayEl.querySelector('#cm-title');
  const descEl = overlayEl.querySelector('#cm-desc');
  const parentEl = overlayEl.querySelector('#cm-parent');
  const priorityEl = overlayEl.querySelector('#cm-priority');
  const startEl = overlayEl.querySelector('#cm-start');
  const dueEl = overlayEl.querySelector('#cm-due');
  const reminderEl = overlayEl.querySelector('#cm-reminder');
  const doneEl = overlayEl.querySelector('#cm-done');
  const ruleKindEl = overlayEl.querySelector('#cm-rule-kind');
  const ruleWeeklyEl = overlayEl.querySelector('#cm-rule-weekly');
  const ruleMonthlyEl = overlayEl.querySelector('#cm-rule-monthly');

  titleEl.focus();

  // Color picker
  overlayEl.querySelector('#cm-colors').addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    selectedColor = dot.dataset.color || null;
    overlayEl.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    dot.classList.add('selected');
  });

  // Label chips
  overlayEl.querySelector('#cm-labels').addEventListener('click', (e) => {
    const chip = e.target.closest('.label-chip');
    if (!chip) return;
    const id = Number(chip.dataset.labelId);
    if (selectedLabelIds.has(id)) {
      selectedLabelIds.delete(id);
      chip.classList.remove('on');
    } else {
      selectedLabelIds.add(id);
      chip.classList.add('on');
    }
  });

  // Inline new label
  overlayEl.querySelector('#cm-newlabel-add').addEventListener('click', async () => {
    const nameEl = overlayEl.querySelector('#cm-newlabel-name');
    const colorEl = overlayEl.querySelector('#cm-newlabel-color');
    const name = (nameEl.value || '').trim();
    if (!name) { nameEl.focus(); return; }
    try {
      const created = await onCreateLabel(name, colorEl.value);
      nameEl.value = '';
      selectedLabelIds.add(Number(created.id));
      // Add chip
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'label-chip on';
      chip.dataset.labelId = created.id;
      chip.style.setProperty('--lc', created.color);
      chip.innerHTML = `<span class="dot"></span><span>${escapeHtml(created.name)}</span>`;
      overlayEl.querySelector('#cm-labels').appendChild(chip);
    } catch (err) {
      alert('Gagal membuat label: ' + err.message);
    }
  });

  // Recurring rule toggles
  ruleKindEl.addEventListener('change', () => {
    ruleWeeklyEl.style.display = ruleKindEl.value === 'weekly' ? 'flex' : 'none';
    ruleMonthlyEl.style.display = ruleKindEl.value === 'monthly' ? 'flex' : 'none';
  });

  const collectRule = () => {
    const kind = ruleKindEl.value;
    if (kind === 'none') return { rule_kind: 'none', rule_dow: [], rule_dom: 0 };
    if (kind === 'daily') return { rule_kind: 'daily', rule_dow: [], rule_dom: 0 };
    if (kind === 'weekly') {
      const dow = [...ruleWeeklyEl.querySelectorAll('input[type=checkbox]:checked')].map(el => Number(el.dataset.dow));
      return { rule_kind: 'weekly', rule_dow: dow, rule_dom: 0 };
    }
    if (kind === 'monthly') {
      const dom = Math.min(31, Math.max(1, Number(overlayEl.querySelector('#cm-rule-dom').value) || 1));
      return { rule_kind: 'monthly', rule_dow: [], rule_dom: dom };
    }
    return { rule_kind: 'none', rule_dow: [], rule_dom: 0 };
  };

  const save = async () => {
    const rule = collectRule();
    const updated = {
      ...card,
      title: titleEl.value.trim() || 'Tanpa judul',
      description: descEl.value,
      parent_id: parentEl.value ? Number(parentEl.value) : null,
      priority: priorityEl.value,
      start_at: fromLocalInput(startEl.value),
      due_at: fromLocalInput(dueEl.value),
      reminder_minutes: Number(reminderEl.value) || 0,
      color: selectedColor,
      completed: doneEl.checked,
      ...rule
    };
    try {
      await onSave(updated);
      // Persist label changes
      const before = new Set((cardLabels || []).map(l => Number(l.id)));
      const after = selectedLabelIds;
      const same = before.size === after.size && [...before].every(x => after.has(x));
      if (!same && typeof onLabelsChange === 'function') {
        await onLabelsChange([...after]);
      }
    } catch (e) {
      alert('Gagal menyimpan: ' + e.message);
      return;
    }
    closeCardModal();
  };

  overlayEl.querySelector('#cm-subtask').addEventListener('click', async () => {
    if (typeof onCreateSubtask === 'function') {
      await onCreateSubtask(card.id);
      closeCardModal();
    }
  });
  overlayEl.querySelector('#cm-save').addEventListener('click', save);
  overlayEl.querySelector('#cm-cancel').addEventListener('click', closeCardModal);
  overlayEl.querySelector('#cm-delete').addEventListener('click', () => {
    if (confirm('Hapus kartu ini?')) {
      onDelete(card.id);
      closeCardModal();
    }
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeCardModal();
  });

  document.addEventListener('keydown', escHandler);
}

function renderHistory(history) {
  if (!history || !history.length) {
    return '<div style="font-size:12px; color:var(--text-faint); padding: 6px 2px;">Belum ada aktivitas.</div>';
  }
  return history.slice(0, 30).map(h => `
    <div class="history-item">
      <div class="history-icon">${historyIcon(h.action)}</div>
      <div class="history-body">
        <div class="history-line"><strong>${escapeHtml(h.username || 'Seseorang')}</strong> ${escapeHtml(describeAction(h.action, h.details || {}))}</div>
        <div class="history-time">${escapeHtml(timeAgo(h.created_at))} • ${escapeHtml(new Date(h.created_at).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }))}</div>
      </div>
    </div>
  `).join('');
}

function historyIcon(action) {
  if (action === 'card.create') return '✨';
  if (action === 'card.delete') return '🗑';
  if (action === 'card.move') return '↔';
  if (action === 'recurring.spawn') return '🔁';
  return '✎';
}

function escHandler(e) {
  if (e.key === 'Escape') closeCardModal();
}

export function closeCardModal() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
    document.removeEventListener('keydown', escHandler);
  }
}
