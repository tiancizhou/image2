const db = require('../db/pool');
const settings = require('./settings');
const points = require('./points');

function shanghaiDate(offsetDays = 0) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const shanghai = new Date(utc + 8 * 60 * 60000 + offsetDays * 86400000);
  return shanghai.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

async function checkin(userId) {
  const today = shanghaiDate();

  const { rows: existing } = await db.query(
    'SELECT id FROM checkins WHERE user_id = $1 AND checkin_date = $2',
    [userId, today]
  );
  if (existing.length > 0) {
    throw new Error('今日已签到');
  }

  const { rows: userRows } = await db.query(
    'SELECT last_checkin_date, consecutive_checkins FROM users WHERE id = $1',
    [userId]
  );
  const user = userRows[0];

  const yesterday = shanghaiDate(-1);
  const lastCheckinDate = normalizeDate(user.last_checkin_date);
  const consecutive = lastCheckinDate === yesterday
    ? user.consecutive_checkins + 1
    : 1;

  const basePoints = parseInt(await settings.get('checkin_points')) || 1;

  let bonusPoints = 0;
  try {
    const bonusJson = await settings.get('checkin_consecutive_bonus');
    const bonusMap = JSON.parse(bonusJson || '{}');
    bonusPoints = parseInt(bonusMap[String(consecutive)]) || 0;
  } catch {}

  const totalPoints = basePoints + bonusPoints;

  await db.query(
    `INSERT INTO checkins (user_id, checkin_date, points_earned) VALUES ($1, $2, $3)`,
    [userId, today, totalPoints]
  );

  await db.query(
    'UPDATE users SET consecutive_checkins = $1, last_checkin_date = $2 WHERE id = $3',
    [consecutive, today, userId]
  );

  const remark = bonusPoints > 0
    ? `签到${consecutive}天 (基础${basePoints}+奖励${bonusPoints})`
    : `每日签到`;
  await points.add(userId, totalPoints, 'checkin', remark);

  return { points: totalPoints, consecutive, basePoints, bonusPoints };
}

async function getStatus(userId) {
  const today = shanghaiDate();
  const { rows } = await db.query(
    'SELECT id FROM checkins WHERE user_id = $1 AND checkin_date = $2',
    [userId, today]
  );
  const { rows: userRows } = await db.query(
    'SELECT consecutive_checkins, last_checkin_date FROM users WHERE id = $1',
    [userId]
  );

  return {
    checkedIn: rows.length > 0,
    consecutive: userRows[0].consecutive_checkins,
    lastDate: normalizeDate(userRows[0].last_checkin_date),
  };
}

module.exports = { checkin, getStatus, shanghaiDate, normalizeDate };
