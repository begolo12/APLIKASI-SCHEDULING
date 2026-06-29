export function isValidId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

export function cleanTitle(value, fallback = 'Tanpa judul') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

export function isValidDateOrNull(value) {
  return value == null || value === '' || !Number.isNaN(new Date(value).getTime());
}

export function normalizeReminderMinutes(value) {
  const n = Number(value);
  return [0, 5, 10, 30].includes(n) ? n : 0;
}
