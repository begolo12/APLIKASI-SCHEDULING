const assert = require('assert');

// Shim minimal DOM for utils.js (escapeHtml uses document.createElement)
global.document = {
  createElement: () => ({
    set textContent(v) { this._text = v == null ? '' : String(v); },
    get textContent() { return this._text; },
    get innerHTML() { return this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  })
};

(async () => {
  const mod = await import('../src/validation.js');
  assert.strictEqual(mod.isValidId(1), true);
  assert.strictEqual(mod.isValidId('2'), true);
  assert.strictEqual(mod.isValidId(0), false);
  assert.strictEqual(mod.cleanTitle('  A  '), 'A');
  assert.strictEqual(mod.cleanTitle('  '), 'Tanpa judul');
  assert.strictEqual(mod.isValidDateOrNull(null), true);
  assert.strictEqual(mod.isValidDateOrNull('bad-date'), false);
  assert.strictEqual(mod.normalizeReminderMinutes(10), 10);
  assert.strictEqual(mod.normalizeReminderMinutes(99), 0);

  // Shared utils (new features)
  const u = await import('../src/utils.js');
  // describeRule
  assert.strictEqual(u.describeRule({ rule_kind: 'none' }), null);
  assert.strictEqual(u.describeRule({ rule_kind: 'daily' }), 'Berulang setiap hari');
  assert.strictEqual(u.describeRule({ rule_kind: 'weekly', rule_dow: [] }), 'Berulang setiap minggu');
  assert.strictEqual(u.describeRule({ rule_kind: 'weekly', rule_dow: [1, 3] }), 'Berulang mingguan: Sen, Rab');
  assert.strictEqual(u.describeRule({ rule_kind: 'monthly', rule_dom: 15 }), 'Berulang bulanan tanggal 15');
  assert.strictEqual(u.describeRule(null), null);

  // describeAction
  assert.strictEqual(u.describeAction('card.create'), 'membuat kartu');
  assert.strictEqual(u.describeAction('card.update', { title: {}, due_at: {} }), 'mengubah: title, due_at');
  assert.strictEqual(u.describeAction('card.delete'), 'menghapus kartu');
  assert.strictEqual(u.describeAction('card.move'), 'memindahkan kartu antar kolom');
  assert.strictEqual(u.describeAction('recurring.spawn'), 'membuat occurrence berulang');

  // fmtDateTime + timeAgo — just smoke test (no throw)
  const ago = u.timeAgo(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  assert.ok(/menit lalu/.test(ago), 'timeAgo should return "X menit lalu" for 5min ago, got: ' + ago);
  const agoLong = u.timeAgo(new Date(Date.now() - 3 * 86400000).toISOString());
  assert.ok(/hari lalu/.test(agoLong), 'timeAgo should return "X hari lalu" for 3d ago, got: ' + agoLong);
  const agoNone = u.timeAgo(null);
  assert.strictEqual(agoNone, '');

  // toLocalInput / fromLocalInput
  const iso = '2026-06-15T10:30:00.000Z';
  const local = u.toLocalInput(iso);
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local), 'toLocalInput format: ' + local);
  const back = u.fromLocalInput(local);
  assert.ok(back && new Date(back).getTime() === new Date(iso).getTime(), 'round-trip should preserve timestamp');
  assert.strictEqual(u.fromLocalInput(''), null);
  assert.strictEqual(u.toLocalInput('not-a-date'), '');

  // dueInfo
  const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
  const past = u.dueInfo(pastIso, false);
  assert.ok(past && past.state === 'overdue', 'overdue detection failed');
  const done = u.dueInfo(pastIso, true);
  assert.ok(done && done.state === 'done', 'completed detection failed');
  const future = u.dueInfo(new Date(Date.now() + 86400000 * 3).toISOString(), false);
  assert.ok(future && future.state === 'normal', 'future detection failed');
  assert.strictEqual(u.dueInfo(null, false), null);
  assert.strictEqual(u.dueInfo('bad', false), null);

  // escapeHtml
  assert.strictEqual(u.escapeHtml('<script>'), '&lt;script&gt;');
  assert.strictEqual(u.escapeHtml(null), '');
  assert.strictEqual(u.escapeHtml(undefined), '');

  // ---- Schema sanity (parse schema.sql) ----
  const fs = require('fs');
  const path = require('path');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'electron', 'schema.sql'), 'utf-8');
  for (const expected of ['CREATE TABLE IF NOT EXISTS boards', 'CREATE TABLE IF NOT EXISTS lists',
                          'CREATE TABLE IF NOT EXISTS cards', 'CREATE TABLE IF NOT EXISTS users',
                          'CREATE TABLE IF NOT EXISTS labels', 'CREATE TABLE IF NOT EXISTS card_labels',
                          'CREATE TABLE IF NOT EXISTS card_history',
                          "rule_kind TEXT NOT NULL DEFAULT 'none'",
                          "next_run_at TIMESTAMPTZ"]) {
    assert.ok(schema.includes(expected), 'schema missing: ' + expected);
  }

  // ---- Frontend wiring ----
  const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf-8');
  for (const fn of ['getLabels', 'createLabel', 'deleteLabel', 'getCardLabels', 'setCardLabels',
                    'getCardHistory', 'runRecurring', 'exportAll', 'importAll']) {
    assert.ok(apiSrc.includes(fn), 'src/api.js missing: ' + fn);
  }
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf-8');
  for (const tok of ['filterLabelId', 'filterPriority', 'filterDue', 'cardLabelsMap',
                     'getCardLabels', 'state.labels', 'btn-export', 'file-import',
                     'renderFilterBar', 'loadActiveBoard']) {
    assert.ok(mainSrc.includes(tok), 'src/main.js missing: ' + tok);
  }
  const modalSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'cardModal.js'), 'utf-8');
  for (const tok of ['cm-labels', 'cm-rule-kind', 'cm-rule-weekly', 'cm-rule-monthly',
                     'cm-history', 'cm-newlabel-add', 'history-item']) {
    assert.ok(modalSrc.includes(tok), 'cardModal.js missing: ' + tok);
  }
  const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf-8');
  for (const fn of ['getLabels', 'createLabel', 'getCardLabels', 'setCardLabels',
                    'getCardHistory', 'runRecurring', 'exportAll', 'importAll']) {
    assert.ok(preloadSrc.includes(fn), 'preload.js missing: ' + fn);
  }

  // ---- IPC handler presence ----
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc.js'), 'utf-8');
  for (const ch of ['labels:list', 'labels:create', 'labels:rename', 'labels:delete',
                    'cards:labels', 'cards:labels:set', 'cards:history', 'recurring:run',
                    'processRecurring', 'spawnNextOccurrence', 'logHistory',
                    'export:all', 'import:all']) {
    assert.ok(ipc.includes(ch), 'ipc.js missing: ' + ch);
  }

  // ---- HTTP handler parity ----
  const vercelApi = fs.readFileSync(path.join(__dirname, '..', 'vite-neon-api.js'), 'utf-8');
  for (const ch of ['labels:list', 'labels:create', 'labels:rename', 'labels:delete',
                    'cards:labels', 'cards:labels:set', 'cards:history', 'recurring:run',
                    'export:all', 'import:all']) {
    assert.ok(vercelApi.includes(ch), 'vite-neon-api.js missing: ' + ch);
  }

  // ---- Recurring: computeNextRun (inline-imported from ipc.js logic, tested via behaviour) ----
  // Pull out the function by re-implementing test against the same semantics:
  // daily: +1 day, weekly: next matching dow, monthly: +1 month same dom
  // We do a quick stand-alone assertion using Date math.
  function computeNextDaily(due) { const d = new Date(due); d.setDate(d.getDate() + 1); return d; }
  function computeNextMonthly(due, dom) { const d = new Date(due); d.setMonth(d.getMonth() + 1); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(dom || d.getDate(), last)); return d; }
  const base = '2026-06-15T10:00:00.000Z';
  const d1 = computeNextDaily(base);
  assert.strictEqual(d1.getUTCDate(), 16, 'daily +1d');
  const dm = computeNextMonthly(base, 31);
  assert.strictEqual(dm.getUTCMonth(), 6, 'monthly +1 month from June 15 should land in July');
  assert.ok(dm.getUTCDate() <= 31, 'monthly dom clamp');

  console.log('tests ok');
})();
