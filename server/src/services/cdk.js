const { v4: uuidv4 } = require('uuid');
const db = require('../db/pool');

function generateCode() {
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, 16);
}

async function batchGenerate(points, count, adminId) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateCode());
  }

  const values = [];
  const params = [];
  let idx = 1;
  for (const code of codes) {
    values.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
    params.push(code, points, adminId);
    idx += 3;
  }

  await db.query(
    `INSERT INTO cdks (code, points, admin_id) VALUES ${values.join(', ')}`,
    params
  );

  return codes;
}

async function redeem(code, userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, points, status FROM cdks WHERE code = $1 FOR UPDATE',
      [code]
    );

    if (rows.length === 0) {
      throw new Error('兑换码不存在');
    }
    const cdk = rows[0];
    if (cdk.status !== 'unused') {
      throw new Error('兑换码已被使用');
    }

    await client.query(
      `UPDATE cdks SET status = 'used', user_id = $1, used_at = NOW() WHERE id = $2`,
      [userId, cdk.id]
    );

    const { rows: userRows } = await client.query(
      'SELECT points FROM users WHERE id = $1 FOR UPDATE', [userId]
    );
    const balanceAfter = userRows[0].points + cdk.points;

    await client.query('UPDATE users SET points = $1 WHERE id = $2', [balanceAfter, userId]);
    await client.query(
      `INSERT INTO point_logs (user_id, type, amount, balance_after, remark)
       VALUES ($1, 'cdk', $2, $3, $4)`,
      [userId, cdk.points, balanceAfter, `兑换码兑换: ${code}`]
    );

    await client.query('COMMIT');
    return { points: cdk.points, balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function list({ status, page = 1, pageSize = 20 }) {
  const offset = (page - 1) * pageSize;
  let where = '';
  const params = [];
  if (status) {
    params.push(status);
    where = `WHERE c.status = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT c.id, c.code, c.points, c.status, c.created_at, c.used_at,
       u.nickname as user_nickname, a.username as admin_username
     FROM cdks c
     LEFT JOIN users u ON c.user_id = u.id
     LEFT JOIN admins a ON c.admin_id = a.id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  const { rows: [{ count }] } = await db.query(
    `SELECT COUNT(*) FROM cdks c ${where}`, params
  );

  return { list: rows, total: parseInt(count), page, pageSize };
}

module.exports = { batchGenerate, redeem, list };
