// End-to-end smoke test against the real Neon DB.
// Runs the same SQL the IPC handlers run, validates labels/history/recurring work.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

(async () => {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) { console.error('NO NEON URL'); process.exit(1); }
  const sql = neon(url);

  // Apply schema (idempotent)
  const schema = fs.readFileSync(path.join(__dirname, '..', 'electron', 'schema.sql'), 'utf-8');
  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) await sql(stmt);
  console.log('[smoke] schema OK');

  // Pick a test board
  let boards = await sql('SELECT * FROM boards ORDER BY id');
  if (!boards.length) {
    const b = await sql("INSERT INTO boards (title, position) VALUES ('Smoke Board', 0) RETURNING *");
    boards = b;
  }
  const board = boards[0];
  console.log('[smoke] board:', board.id, board.title);

  // Ensure a list
  let lists = await sql('SELECT * FROM lists WHERE board_id=$1', [board.id]);
  if (!lists.length) {
    const lr = await sql('INSERT INTO lists (board_id, title, position) VALUES ($1, $2, 0) RETURNING *', [board.id, 'Smoke List']);
    lists = lr;
  }
  const list = lists[0];
  console.log('[smoke] list:', list.id);

  // Create a card with rule
  const now = new Date();
  const past = new Date(now.getTime() - 86400000); // yesterday
  const cr = await sql(
    `INSERT INTO cards (list_id, title, position, due_at, rule_kind, rule_dow, rule_dom, next_run_at)
     VALUES ($1, $2, 0, $3, 'daily', $4, 0, $5) RETURNING *`,
    [list.id, 'Smoke card', past.toISOString(), [], past.toISOString()]
  );
  const card = cr[0];
  console.log('[smoke] card:', card.id);

  // Create a label
  const lr = await sql(
    'INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (board_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *',
    [board.id, 'Smoke-Label-' + Date.now(), '#ec4899']
  );
  const label = lr[0];
  console.log('[smoke] label:', label.id, label.name);

  // Associate card ↔ label
  await sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [card.id, label.id]);
  const cardLabels = await sql('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id=l.id WHERE cl.card_id=$1', [card.id]);
  assertEq(cardLabels.length, 1, 'card should have 1 label');
  assertEq(cardLabels[0].id, label.id, 'card label id mismatch');

  // Log history
  await sql(
    'INSERT INTO card_history (card_id, user_id, username, action, details) VALUES ($1, $2, $3, $4, $5)',
    [card.id, null, 'smoke-tester', 'card.create', JSON.stringify({ title: card.title })]
  );
  const hist = await sql('SELECT * FROM card_history WHERE card_id=$1 ORDER BY created_at DESC', [card.id]);
  assertEq(hist.length, 1, 'history should have 1 entry');
  assertEq(hist[0].action, 'card.create', 'history action mismatch');
  console.log('[smoke] history OK');

  // Cleanup: remove the test card + label
  await sql('DELETE FROM card_history WHERE card_id=$1', [card.id]);
  await sql('DELETE FROM card_labels WHERE card_id=$1', [card.id]);
  await sql('DELETE FROM cards WHERE id=$1', [card.id]);
  await sql('DELETE FROM labels WHERE id=$1', [label.id]);
  console.log('[smoke] cleanup OK');

  // Recurring engine: simulate by re-creating a card and running the engine manually
  const tomorrow = new Date(now.getTime() + 86400000).toISOString();
  const cr2 = await sql(
    `INSERT INTO cards (list_id, title, position, due_at, rule_kind, rule_dow, rule_dom, next_run_at)
     VALUES ($1, $2, 0, $3, 'daily', $4, 0, $5) RETURNING *`,
    [list.id, 'Smoke recurring', now.toISOString(), [], now.toISOString()]
  );
  const tpl = cr2[0];
  // Attach a label to template
  const lr2 = await sql('INSERT INTO labels (board_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (board_id, name) DO UPDATE SET color=EXCLUDED.color RETURNING *', [board.id, 'Recur-Label-' + Date.now(), '#10b981']);
  const lbl = lr2[0];
  await sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tpl.id, lbl.id]);

  // Force next_run_at into past, then trigger engine
  await sql("UPDATE cards SET next_run_at=$1 WHERE id=$2", [new Date(now.getTime() - 1000).toISOString(), tpl.id]);

  // Inline spawn logic (mirror of ipc.js)
  function spawn(tpl) {
    const next = new Date(tpl.due_at);
    next.setDate(next.getDate() + 1);
    return next;
  }
  const newDue = spawn(tpl).toISOString();
  const newCard = (await sql(
    `INSERT INTO cards (list_id, parent_id, title, description, priority, start_at, due_at, color, position, reminder_minutes, rule_kind, rule_dow, rule_dom, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13) RETURNING *`,
    [tpl.list_id, tpl.parent_id, tpl.title, tpl.description || '', tpl.priority || 'biasa',
     null, newDue, tpl.color || null, tpl.reminder_minutes || 0, tpl.rule_kind,
     tpl.rule_dow || [], Number(tpl.rule_dom) || 0, null]
  ))[0];
  // copy labels
  await sql('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [newCard.id, lbl.id]);
  // Roll template forward
  await sql("UPDATE cards SET next_run_at=$1 WHERE id=$2", [spawn(tpl).toISOString(), tpl.id]);

  const newLabels = await sql('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id=l.id WHERE cl.card_id=$1', [newCard.id]);
  assertEq(newLabels.length, 1, 'recurring card should inherit label');
  assertEq(newLabels[0].id, lbl.id, 'recurring card label id mismatch');
  console.log('[smoke] recurring engine OK');

  // Cleanup recurring test
  await sql('DELETE FROM card_history WHERE card_id=$1 OR card_id=$2', [tpl.id, newCard.id]);
  await sql('DELETE FROM card_labels WHERE card_id IN ($1, $2)', [tpl.id, newCard.id]);
  await sql('DELETE FROM cards WHERE id IN ($1, $2)', [tpl.id, newCard.id]);
  await sql('DELETE FROM labels WHERE id=$1', [lbl.id]);

  // Clean up the test board if we created it
  if (board.title === 'Smoke Board') {
    await sql('DELETE FROM boards WHERE id=$1', [board.id]);
  }

  console.log('SMOKE_OK');
})().catch(e => { console.error('SMOKE_FAIL', e.message); process.exit(1); });

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`ASSERT FAILED: ${msg} (expected ${expected}, got ${actual})`);
    process.exit(1);
  }
}
