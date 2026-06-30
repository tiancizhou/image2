const db = require('../db/pool');

const RULES = [
  {
    key: 'checkin_3_days',
    source: 'checkin',
    title: '连续签到满 3 天',
    description: '连续签到达到 3 天可领取 1 次抽奖机会。',
    amount: 1,
    isMet: stats => stats.consecutiveCheckins >= 3,
    progress: stats => Math.min(stats.consecutiveCheckins, 3),
    target: 3,
  },
  {
    key: 'invite_3_friends',
    source: 'invite',
    title: '邀请 3 位好友',
    description: '累计邀请 3 位新用户可领取 1 次抽奖机会。',
    amount: 1,
    isMet: stats => stats.inviteCount >= 3,
    progress: stats => Math.min(stats.inviteCount, 3),
    target: 3,
  },
  {
    key: 'invite_5_friends',
    source: 'invite',
    title: '邀请 5 位好友',
    description: '累计邀请 5 位新用户可再领取 1 次抽奖机会。',
    amount: 1,
    isMet: stats => stats.inviteCount >= 5,
    progress: stats => Math.min(stats.inviteCount, 5),
    target: 5,
  },
  {
    key: 'invite_10_friends',
    source: 'invite',
    title: '邀请 10 位好友',
    description: '累计邀请 10 位新用户可领取 2 次抽奖机会。',
    amount: 2,
    isMet: stats => stats.inviteCount >= 10,
    progress: stats => Math.min(stats.inviteCount, 10),
    target: 10,
  },
];

async function getActiveCampaign(client = db) {
  const { rows } = await client.query(
    `SELECT id, name, description, starts_at, ends_at
     FROM lottery_campaigns
     WHERE status = 'active'
       AND starts_at <= NOW()
       AND (ends_at IS NULL OR ends_at >= NOW())
     ORDER BY id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getUserStats(userId, client = db) {
  const { rows: userRows } = await client.query(
    'SELECT id, points, consecutive_checkins FROM users WHERE id = $1',
    [userId]
  );
  if (userRows.length === 0) {
    const err = new Error('用户不存在');
    err.status = 404;
    throw err;
  }

  const { rows: inviteRows } = await client.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE invited_by_user_id = $1',
    [userId]
  );

  return {
    points: userRows[0].points,
    consecutiveCheckins: Number(userRows[0].consecutive_checkins || 0),
    inviteCount: Number(inviteRows[0]?.count || 0),
  };
}

async function getChanceSummary(userId, campaignId, client = db) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(amount), 0)::int AS total,
       COALESCE(SUM(remaining), 0)::int AS remaining
     FROM lottery_chances
     WHERE user_id = $1 AND campaign_id = $2`,
    [userId, campaignId]
  );
  return {
    total: Number(rows[0]?.total || 0),
    remaining: Number(rows[0]?.remaining || 0),
  };
}

async function getClaimedRuleKeys(userId, campaignId, client = db) {
  const { rows } = await client.query(
    `SELECT rule_key FROM lottery_chances
     WHERE user_id = $1 AND campaign_id = $2`,
    [userId, campaignId]
  );
  return new Set(rows.map(row => row.rule_key));
}

function buildRuleStatus(stats, claimedKeys) {
  return RULES.map(rule => {
    const met = rule.isMet(stats);
    const claimed = claimedKeys.has(rule.key);
    return {
      key: rule.key,
      source: rule.source,
      title: rule.title,
      description: rule.description,
      amount: rule.amount,
      progress: rule.progress(stats),
      target: rule.target,
      met,
      claimed,
      claimable: met && !claimed,
    };
  });
}

async function getPrizes(campaignId, client = db) {
  const { rows } = await client.query(
    `SELECT id, name, type, points, weight, stock, sort_order
     FROM lottery_prizes
     WHERE campaign_id = $1 AND enabled = TRUE
     ORDER BY sort_order ASC, id ASC`,
    [campaignId]
  );
  return rows;
}

async function getHistory(userId, campaignId, limit = 10, client = db) {
  const { rows } = await client.query(
    `SELECT id, prize_name, prize_type, points, created_at
     FROM lottery_draws
     WHERE user_id = $1 AND campaign_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, campaignId, limit]
  );
  return rows;
}

async function getMe(userId) {
  const campaign = await getActiveCampaign();
  if (!campaign) {
    return {
      active: false,
      campaign: null,
      stats: null,
      chances: { total: 0, remaining: 0 },
      rules: [],
      prizes: [],
      history: [],
    };
  }

  const [stats, chances, claimedKeys, prizes, history] = await Promise.all([
    getUserStats(userId),
    getChanceSummary(userId, campaign.id),
    getClaimedRuleKeys(userId, campaign.id),
    getPrizes(campaign.id),
    getHistory(userId, campaign.id),
  ]);

  return {
    active: true,
    campaign,
    stats,
    chances,
    rules: buildRuleStatus(stats, claimedKeys),
    prizes: prizes.map(publicPrize),
    history,
  };
}

async function claimRules(userId) {
  const client = await db.getClient();
  let granted = [];
  try {
    await client.query('BEGIN');
    const campaign = await getActiveCampaign(client);
    if (!campaign) {
      const err = new Error('当前没有可参与的抽奖活动');
      err.status = 404;
      throw err;
    }

    const stats = await getUserStats(userId, client);
    const claimedKeys = await getClaimedRuleKeys(userId, campaign.id, client);
    const claimableRules = RULES.filter(rule => rule.isMet(stats) && !claimedKeys.has(rule.key));

    for (const rule of claimableRules) {
      const { rows } = await client.query(
        `INSERT INTO lottery_chances (user_id, campaign_id, source, rule_key, amount, remaining, remark)
         VALUES ($1, $2, $3, $4, $5, $5, $6)
         ON CONFLICT (user_id, campaign_id, rule_key) DO NOTHING
         RETURNING id, source, rule_key, amount, remaining, remark, created_at`,
        [userId, campaign.id, rule.source, rule.key, rule.amount, rule.title]
      );
      if (rows[0]) granted.push(rows[0]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    granted,
    me: await getMe(userId),
  };
}

async function draw(userId) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const campaign = await getActiveCampaign(client);
    if (!campaign) {
      const err = new Error('当前没有可参与的抽奖活动');
      err.status = 404;
      throw err;
    }

    const { rows: chanceRows } = await client.query(
      `SELECT id, remaining
       FROM lottery_chances
       WHERE user_id = $1 AND campaign_id = $2 AND remaining > 0
       ORDER BY created_at ASC, id ASC
       LIMIT 1
       FOR UPDATE`,
      [userId, campaign.id]
    );
    if (chanceRows.length === 0) {
      const err = new Error('暂无抽奖次数，请先完成签到或邀请任务');
      err.status = 400;
      throw err;
    }

    const prize = await pickPrize(campaign.id, client);
    await client.query(
      'UPDATE lottery_chances SET remaining = remaining - 1 WHERE id = $1',
      [chanceRows[0].id]
    );

    if (prize.stock !== null && prize.stock !== undefined) {
      const { rowCount } = await client.query(
        `UPDATE lottery_prizes
         SET stock = stock - 1
         WHERE id = $1 AND stock > 0`,
        [prize.id]
      );
      if (rowCount === 0) {
        const err = new Error('奖品库存不足，请重试');
        err.status = 409;
        throw err;
      }
    }

    const { rows: drawRows } = await client.query(
      `INSERT INTO lottery_draws (user_id, campaign_id, chance_id, prize_id, prize_name, prize_type, points)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, prize_name, prize_type, points, created_at`,
      [userId, campaign.id, chanceRows[0].id, prize.id, prize.name, prize.type, prize.points || 0]
    );

    if (prize.type === 'points' && prize.points > 0) {
      const { rows: userRows } = await client.query(
        'SELECT points FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const balanceAfter = Number(userRows[0].points || 0) + Number(prize.points || 0);
      await client.query('UPDATE users SET points = $1 WHERE id = $2', [balanceAfter, userId]);
      await client.query(
        `INSERT INTO point_logs (user_id, type, amount, balance_after, remark)
         VALUES ($1, 'lottery', $2, $3, $4)`,
        [userId, prize.points, balanceAfter, `抽奖获得：${prize.name}`]
      );
    }

    await client.query('COMMIT');
    return {
      draw: drawRows[0],
      me: await getMe(userId),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function pickPrize(campaignId, client) {
  const { rows } = await client.query(
    `SELECT id, name, type, points, weight, stock
     FROM lottery_prizes
     WHERE campaign_id = $1
       AND enabled = TRUE
       AND weight > 0
       AND type = 'points'
       AND points > 0
       AND (stock IS NULL OR stock > 0)
     ORDER BY id ASC
     FOR UPDATE`,
    [campaignId]
  );
  if (rows.length === 0) {
    const err = new Error('当前没有可用奖品');
    err.status = 500;
    throw err;
  }

  const totalWeight = rows.reduce((sum, prize) => sum + Number(prize.weight || 0), 0);
  let cursor = Math.random() * totalWeight;
  for (const prize of rows) {
    cursor -= Number(prize.weight || 0);
    if (cursor <= 0) return prize;
  }
  return rows[rows.length - 1];
}

function publicPrize(prize) {
  return {
    id: prize.id,
    name: prize.name,
    type: prize.type,
    points: prize.points,
    sort_order: prize.sort_order,
  };
}

module.exports = {
  getMe,
  claimRules,
  draw,
};
