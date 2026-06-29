// Shared helpers for FlowBoard renderer.

export const LABEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#38bdf8', '#f43f5e'
];

// Convert a JS Date / ISO string to the value format datetime-local expects.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d) ? null : d.toISOString();
}

// Human-readable due label + urgency state.
export function dueInfo(iso, completed) {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due)) return null;
  const now = new Date();
  const diffMs = due - now;
  const oneDay = 86400000;

  const sameDay = due.toDateString() === now.toDateString();
  const opts = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  let label = due.toLocaleString('id-ID', opts);
  if (sameDay) label = `Hari ini ${label}`;

  let state = 'normal';
  if (completed) state = 'done';
  else if (diffMs < 0) state = 'overdue';
  else if (diffMs < oneDay) state = 'soon';

  return { label, state };
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
