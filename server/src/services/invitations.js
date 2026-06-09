const db = require('../db/pool');
const settings = require('./settings');

function normalizeInviteCode(code) {
  const value = String(code || '').trim();
  return /^\d+$/.test(value) ? value : '';
}

function publicInviteCode(userId) {
  return String(userId || '');
}

async function getInviteRewardPoints() {
  const value = Number.parseInt(await settings.get('invite_reward_points'), 10);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

async function resolveInviterId(inviteCode) {
  const normalized = normalizeInviteCode(inviteCode);
  if (!normalized) return null;

  const inviterId = Number.parseInt(normalized, 10);
  if (!Number.isFinite(inviterId) || inviterId <= 0) return null;

  const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [inviterId]);
  return rows.length > 0 ? inviterId : null;
}

async function rewardInviter({ inviterId, invitedUserId }) {
  if (!inviterId || !invitedUserId || inviterId === invitedUserId) return null;

  const reward = await getInviteRewardPoints();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: invitedRows } = await client.query(
      'SELECT invited_by_user_id FROM users WHERE id = $1 FOR UPDATE',
      [invitedUserId]
    );
    if (invitedRows.length === 0 || invitedRows[0].invited_by_user_id) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: inviterRows } = await client.query(
      'SELECT points FROM users WHERE id = $1 FOR UPDATE',
      [inviterId]
    );
    if (inviterRows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const balanceAfter = inviterRows[0].points + reward;
    await client.query(
      'UPDATE users SET points = $1 WHERE id = $2',
      [balanceAfter, inviterId]
    );
    await client.query(
      'UPDATE users SET invited_by_user_id = $1, invited_at = NOW() WHERE id = $2',
      [inviterId, invitedUserId]
    );
    await client.query(
      `INSERT INTO point_logs (user_id, type, amount, balance_after, remark)
       VALUES ($1, 'invite', $2, $3, $4)`,
      [inviterId, reward, balanceAfter, `邀请新用户 #${invitedUserId}`]
    );

    await client.query('COMMIT');
    return { reward, balanceAfter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeInviteCode,
  publicInviteCode,
  resolveInviterId,
  rewardInviter,
  getInviteRewardPoints,
};
