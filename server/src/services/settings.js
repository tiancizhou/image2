const db = require('../db/pool');

const cache = {};

async function get(key) {
  if (cache[key] !== undefined) return cache[key];
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  if (rows.length === 0) return null;
  cache[key] = rows[0].value;
  return cache[key];
}

async function set(key, value) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
  cache[key] = value;
}

async function getAll() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
    cache[row.key] = row.value;
  }
  return result;
}

function clearCache() {
  for (const k in cache) delete cache[k];
}

module.exports = { get, set, getAll, clearCache };
