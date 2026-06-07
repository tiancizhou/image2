const db = require('../db/pool');

async function getUserPoints(userId) {
  const { rows } = await db.query('SELECT points FROM users WHERE id = $1', [userId]);
  return rows[0]?.points ?? 0;
}

async function consume(userId, amount, remark) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT points FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const current = rows[0].points;
    if (current < amount) {
      throw new Error('积分不足');
    }
    const balanceAfter = current - amount;

    await client.query(
      'UPDATE users SET points = $1 WHERE id = $2',
      [balanceAfter, userId]
    );
    await client.query(
      `INSERT INTO point_logs (user_id, type, amount, balance_after, remark)
       VALUES ($1, 'consume', $2, $3, $4)`,
      [userId, -amount, balanceAfter, remark || '']
    );

    await client.query('COMMIT');
    return balanceAfter;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function add(userId, amount, type, remark, adminId = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT points FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const balanceAfter = rows[0].points + amount;

    await client.query(
      'UPDATE users SET points = $1 WHERE id = $2',
      [balanceAfter, userId]
    );
    await client.query(
      `INSERT INTO point_logs (user_id, type, amount, balance_after, remark, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, amount, balanceAfter, remark || '', adminId]
    );

    await client.query('COMMIT');
    return balanceAfter;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getLogs(userId, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const { rows } = await db.query(
    `SELECT id, type, amount, balance_after, remark, created_at
     FROM point_logs WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, pageSize, offset]
  );
  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*) FROM point_logs WHERE user_id = $1', [userId]
  );
  return { list: rows, total: parseInt(count), page, pageSize };
}

module.exports = { getUserPoints, consume, add, getLogs };
