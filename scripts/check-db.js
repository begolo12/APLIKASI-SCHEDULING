require('dotenv').config();

(async () => {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.log('DB_MODE=local fallback (NEON_DATABASE_URL not set)');
    return;
  }
  if (!url.startsWith('postgres')) {
    console.error('Invalid NEON_DATABASE_URL: must start with postgres/postgresql');
    process.exit(1);
  }
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);
  const rows = await sql('select now() as now');
  console.log('DB_MODE=neon OK', rows[0].now);
})().catch((e) => {
  console.error('DB_CHECK_FAILED', e.message);
  process.exit(1);
});
