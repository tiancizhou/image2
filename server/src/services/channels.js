const db = require('../db/pool');

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function normalizeChannel(input) {
  return {
    name: String(input.name || '').trim(),
    base_url: String(input.base_url || '').trim().replace(/\/+$/, ''),
    api_key: String(input.api_key || '').trim(),
    enabled: input.enabled !== false,
    priority: Number.parseInt(input.priority, 10) || 100,
    timeout_ms: Number.parseInt(input.timeout_ms, 10) || 120000,
    failure_threshold: Number.parseInt(input.failure_threshold, 10) || 3,
    cooldown_seconds: Number.parseInt(input.cooldown_seconds, 10) || 300,
  };
}

function assertValid(channel) {
  if (!channel.name) throw badRequest('请输入渠道名称');
  if (!channel.base_url) throw badRequest('请输入中转站 Base URL');
  if (!channel.api_key) throw badRequest('请输入 API Key');
  if (!/^https?:\/\//i.test(channel.base_url)) throw badRequest('Base URL 必须以 http:// 或 https:// 开头');
  if (channel.timeout_ms < 1000 || channel.timeout_ms > 300000) throw badRequest('超时时间必须在 1000-300000ms 之间');
  if (channel.failure_threshold < 1 || channel.failure_threshold > 20) throw badRequest('失败阈值必须在 1-20 之间');
  if (channel.cooldown_seconds < 10 || channel.cooldown_seconds > 86400) throw badRequest('熔断冷却必须在 10-86400 秒之间');
}

async function list() {
  const { rows } = await db.query(
    `SELECT id, name, base_url, enabled, priority, timeout_ms, failure_threshold, cooldown_seconds,
      consecutive_failures, circuit_status, circuit_open_until, last_error, last_success_at,
      last_failure_at, created_at, updated_at
     FROM api_channels
     ORDER BY priority ASC, id ASC`
  );
  return rows;
}

async function create(input) {
  const channel = normalizeChannel(input);
  assertValid(channel);
  const { rows: [row] } = await db.query(
    `INSERT INTO api_channels
      (name, base_url, api_key, enabled, priority, timeout_ms, failure_threshold, cooldown_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      channel.name,
      channel.base_url,
      channel.api_key,
      channel.enabled,
      channel.priority,
      channel.timeout_ms,
      channel.failure_threshold,
      channel.cooldown_seconds,
    ]
  );
  return row;
}

async function update(id, input) {
  const { rows } = await db.query('SELECT api_key FROM api_channels WHERE id = $1', [id]);
  if (rows.length === 0) throw badRequest('渠道不存在');

  const channel = normalizeChannel({
    ...input,
    api_key: String(input.api_key || '').trim() || rows[0].api_key,
  });
  assertValid(channel);
  const { rowCount } = await db.query(
    `UPDATE api_channels SET
      name = $1,
      base_url = $2,
      api_key = $3,
      enabled = $4,
      priority = $5,
      timeout_ms = $6,
      failure_threshold = $7,
      cooldown_seconds = $8,
      updated_at = NOW()
     WHERE id = $9`,
    [
      channel.name,
      channel.base_url,
      channel.api_key,
      channel.enabled,
      channel.priority,
      channel.timeout_ms,
      channel.failure_threshold,
      channel.cooldown_seconds,
      id,
    ]
  );
  if (rowCount === 0) throw badRequest('渠道不存在');
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM api_channels WHERE id = $1', [id]);
  if (rowCount === 0) throw badRequest('渠道不存在');
}

async function resetCircuit(id) {
  const { rowCount } = await db.query(
    `UPDATE api_channels SET
      consecutive_failures = 0,
      circuit_status = 'closed',
      circuit_open_until = NULL,
      last_error = NULL,
      updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
  if (rowCount === 0) throw badRequest('渠道不存在');
}

async function getCandidates() {
  const { rows } = await db.query(
    `SELECT *
     FROM api_channels
     WHERE enabled = TRUE
       AND (circuit_status <> 'open' OR circuit_open_until IS NULL OR circuit_open_until <= NOW())
     ORDER BY priority ASC, id ASC`
  );
  return rows;
}

async function markSuccess(id) {
  await db.query(
    `UPDATE api_channels SET
      consecutive_failures = 0,
      circuit_status = 'closed',
      circuit_open_until = NULL,
      last_error = NULL,
      last_success_at = NOW(),
      updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

async function markFailure(channel, error) {
  const nextFailures = (channel.consecutive_failures || 0) + 1;
  const shouldOpen = nextFailures >= channel.failure_threshold;
  await db.query(
    `UPDATE api_channels SET
      consecutive_failures = $1,
      circuit_status = $2,
      circuit_open_until = CASE WHEN $3 THEN NOW() + ($4 || ' seconds')::interval ELSE circuit_open_until END,
      last_error = $5,
      last_failure_at = NOW(),
      updated_at = NOW()
     WHERE id = $6`,
    [
      nextFailures,
      shouldOpen ? 'open' : 'closed',
      shouldOpen,
      channel.cooldown_seconds,
      String(error.message || error).slice(0, 2000),
      channel.id,
    ]
  );
}

module.exports = {
  list,
  create,
  update,
  remove,
  resetCircuit,
  getCandidates,
  markSuccess,
  markFailure,
};
