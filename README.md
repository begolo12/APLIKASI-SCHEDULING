# FlowBoard

Aplikasi scheduling bergaya Kanban (Trello-like) dengan WBS hierarkis, kalender, timeline Gantt, recurring cards, labels, dan activity log. Single source of truth: **Neon Postgres**.

## Stack

- **Frontend**: Vanilla JS + Vite, dark navy theme, no framework dependencies.
- **Backend**: Electron IPC + Vercel serverless (`/api/[channel].js` style) — both layers talk to Neon via `@neondatabase/serverless`.
- **DB**: PostgreSQL (Neon). Schema in `electron/schema.sql` is applied on every boot.

## Quick start

```bash
cp .env.example .env       # isi NEON_DATABASE_URL dari dashboard Neon
npm install
npm run dev                # Vite + Electron
```

Buka `http://localhost:5173` (Vite) atau jalankan `npm run dist` untuk build installer Windows.

Login bawaan: `admin` / `admin123` (ganti setelah login pertama dari menu Pengaturan → Manajemen Pengguna).

## Scripts

| Perintah              | Fungsi                                              |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | Vite dev server + Electron window, auto-reload     |
| `npm run build`       | Build frontend (Vite) → `dist/`                     |
| `npm run dist`        | Build + electron-builder → installer Windows di `release/` |
| `npm test`            | Unit test untuk utils + smoke checks                |
| `npm run db:check`    | Ping Neon; print `DB_MODE=neon OK <timestamp>`      |
| `node scripts/smoke.js` | E2E smoke test: schema + labels + history + recurring |

## Fitur

- **Boards / Lists / Cards** — CRUD lengkap, drag & drop reorder, parent-subtask (WBS).
- **Calendar & Gantt** — view bulanan (drag-drop event), Gantt proporsional harian/bulanan.
- **Subtask progress** — progress bar otomatis dari jumlah subtask selesai.
- **Reminder** — local notification saat due date tiba (configurable lead time: 0/5/10/30 min).
- **Auth + User management** — register, admin approve, role-based (admin/user).
- **🏷️ Labels** — multi-label per kartu, per-board. Bikin & hapus di menu Pengaturan.
- **🔁 Recurring cards** — daily / weekly (pilih hari) / monthly (pilih tanggal). Occurrence baru otomatis dibuat dengan label & warna yang diwariskan.
- **📜 Activity log** — setiap perubahan kartu (judul, due, perpindahan kolom, dst) tercatat per-user di `card_history`. Tersedia di modal detail kartu.
- **Filter bar** — filter by label, priority, dan tenggat (overdue/today/week/open).
- **💾 Backup & Restore** — export semua data ke JSON, import kembali. Password user tidak ikut (aman untuk sharing).

## Skema

Lihat `electron/schema.sql`. Tabel utama:

- `boards`, `lists`, `cards`, `users` — entity inti.
- `labels`, `card_labels` — multi-label per kartu.
- `card_history` — audit trail per kartu (JSONB `details`).

## Arsitektur

```
┌──────────────────┐    IPC     ┌──────────────────┐    SQL    ┌──────────────┐
│  Electron main   │◀──────────▶│  preload bridge  │◀─────────▶│  Neon DB     │
│  (electron/ipc)  │            │  (window.api)    │           │              │
└──────────────────┘            └──────────────────┘           └──────────────┘
        ▲
        │  HTTP /api/<channel>
        ▼
┌──────────────────┐                      ┌──────────────────┐
│  Vite dev server │─────────────────────▶│  vite-neon-api   │──▶ Neon
│  (browser)       │                      │  (handlers map)  │
└──────────────────┘                      └──────────────────┘
```

Kedua path (Electron + Vite) menjalankan handler set yang **identik**. `vite-neon-api.js` untuk Vercel/preview; `electron/ipc.js` untuk desktop.

## Konvensi

- Saldo awal boards: "Jadwal Saya" + 3 kolom (To Do / In Progress / Done) — dibuat otomatis kalau DB kosong.
- Hash password: SHA-256 (sederhana, sesuai scope desktop/internal).
- Recurring sweep jalan tiap 5 menit di Electron; untuk production, pasang cron job yang panggil `recurring:run` channel.
- History di-truncate secara logis (limit 30 di UI), DB tidak di-truncate otomatis.
