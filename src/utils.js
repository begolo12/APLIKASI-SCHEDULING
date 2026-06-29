// Shared helpers for FlowBoard renderer.

export const LABEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#38bdf8', '#f43f5e'
];

export const DAY_LABELS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

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

// Format ISO timestamp → "12 Jun 2026, 14:30" (id-ID short).
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Humanise a relative time (e.g. "2 menit lalu", "kemarin").
export function timeAgo(iso) {
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
  return fmtDateTime(iso);
}

// Translate history action to friendly Indonesian.
export function describeAction(action, details = {}) {
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

// Compact recurring rule summary in Bahasa.
export function describeRule(card) {
  if (!card || !card.rule_kind || card.rule_kind === 'none') return null;
  if (card.rule_kind === 'daily') return 'Berulang setiap hari';
  if (card.rule_kind === 'weekly') {
    const dow = Array.isArray(card.rule_dow) ? card.rule_dow : [];
    if (!dow.length) return 'Berulang setiap minggu';
    const names = dow.slice().sort().map(d => DAY_LABELS_ID[d]);
    return `Berulang mingguan: ${names.join(', ')}`;
  }
  if (card.rule_kind === 'monthly') {
    const dom = Number(card.rule_dom) || 1;
    return `Berulang bulanan tanggal ${dom}`;
  }
  return null;
}
