// Card detail modal: edit title, description, due date/time, color, completed.
import { LABEL_COLORS, toLocalInput, fromLocalInput, escapeHtml } from '../utils.js';

let overlayEl = null;

export function openCardModal(card, { cards = [], onCreateSubtask, onSave, onDelete }) {
  closeCardModal();

  let selectedColor = card.color || null;

  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
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
        <label>Label Warna</label>
        <div class="color-row" id="cm-colors">
          ${LABEL_COLORS.map(c => `<div class="color-dot ${selectedColor === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
          <div class="color-dot ${!selectedColor ? 'selected' : ''}" data-color="" style="background:var(--bg-elevated)" title="Tanpa warna">∅</div>
        </div>
      </div>

      <label class="toggle-done" for="cm-done">
        <input id="cm-done" type="checkbox" ${card.completed ? 'checked' : ''} />
        Tandai selesai
      </label>

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
  const doneEl = overlayEl.querySelector('#cm-done');

  titleEl.focus();

  overlayEl.querySelector('#cm-colors').addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    selectedColor = dot.dataset.color || null;
    overlayEl.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    dot.classList.add('selected');
  });

  const save = () => {
    const updated = {
      ...card,
      title: titleEl.value.trim() || 'Tanpa judul',
      description: descEl.value,
      parent_id: parentEl.value ? Number(parentEl.value) : null,
      priority: priorityEl.value,
      start_at: fromLocalInput(startEl.value),
      due_at: fromLocalInput(dueEl.value),
      color: selectedColor,
      completed: doneEl.checked
    };
    onSave(updated);
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
    onDelete(card.id);
    closeCardModal();
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeCardModal();
  });

  document.addEventListener('keydown', escHandler);
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
