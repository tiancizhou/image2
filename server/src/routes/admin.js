const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminAuth = require('../middleware/admin-auth');
const db = require('../db/pool');
const config = require('../config');
const settingsService = require('../services/settings');
const pointsService = require('../services/points');
const cdkService = require('../services/cdk');
const channelsService = require('../services/channels');

const router = express.Router();

function pageSize(queryValue, fallback = 20, max = 50) {
  const value = parseInt(queryValue, 10) || fallback;
  return Math.min(Math.max(value, 1), max);
}

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

    const { rows } = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (rows.length === 0) return res.status(400).json({ error: '用户名或密码错误' });

    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(400).json({ error: '用户名或密码错误' });

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: 'admin' },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    res.json({ token, username: admin.username });
  } catch (err) {
    next(err);
  }
});

router.get('/users', adminAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = pageSize(req.query.pageSize);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let where = '';
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE nickname ILIKE $${params.length} OR openid ILIKE $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT id, openid, nickname, avatar_url, points, consecutive_checkins, last_checkin_date, created_at, last_login_at
       FROM users ${where}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM users ${where}`, params
    );
    res.json({ list: rows, total: parseInt(count), page, pageSize: limit });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/recharge', adminAuth, async (req, res, next) => {
  try {
    const { amount, remark } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: '充值金额必须大于 0' });

    const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });

    const balanceAfter = await pointsService.add(
      req.params.id, amount, 'recharge', remark || '管理员充值', req.adminId
    );
    res.json({ balance_after: balanceAfter });
  } catch (err) {
    next(err);
  }
});

router.get('/generations', adminAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = pageSize(req.query.pageSize);
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT g.id, g.type, g.prompt, g.model, g.size, g.points_cost, g.status, g.error_message, g.created_at,
       u.nickname as user_nickname, u.id as user_id, c.name as channel_name
       FROM generations g
       LEFT JOIN users u ON g.user_id = u.id
       LEFT JOIN api_channels c ON g.channel_id = c.id
       ORDER BY g.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: [{ count }] } = await db.query('SELECT COUNT(*) FROM generations');
    res.json({ list: rows, total: parseInt(count), page, pageSize: limit });
  } catch (err) {
    next(err);
  }
});

router.get('/settings', adminAuth, async (req, res, next) => {
  try {
    const all = await settingsService.getAll();
    res.json(all);
  } catch (err) {
    next(err);
  }
});

router.put('/settings', adminAuth, async (req, res, next) => {
  try {
    const allowed = [
      'default_model',
      'points_per_generation',
      'points_cost_1k',
      'points_cost_2k',
      'points_cost_4k',
      'invite_reward_points',
      'checkin_points',
      'checkin_consecutive_bonus',
    ];
    for (const [key, value] of Object.entries(req.body)) {
      if (allowed.includes(key)) {
        await settingsService.set(key, value);
      }
    }
    settingsService.clearCache();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/channels', adminAuth, async (req, res, next) => {
  try {
    res.json({ list: await channelsService.list() });
  } catch (err) {
    next(err);
  }
});

router.post('/channels', adminAuth, async (req, res, next) => {
  try {
    const channel = await channelsService.create(req.body);
    res.json(channel);
  } catch (err) {
    next(err);
  }
});

router.put('/channels/:id', adminAuth, async (req, res, next) => {
  try {
    await channelsService.update(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/channels/:id', adminAuth, async (req, res, next) => {
  try {
    await channelsService.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/channels/:id/reset', adminAuth, async (req, res, next) => {
  try {
    await channelsService.resetCircuit(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/cdk/generate', adminAuth, async (req, res, next) => {
  try {
    const { points, count } = req.body;
    if (!points || points <= 0) return res.status(400).json({ error: '积分数量必须大于 0' });
    if (!count || count <= 0 || count > 1000) return res.status(400).json({ error: '生成数量 1-1000' });

    const codes = await cdkService.batchGenerate(points, count, req.adminId);
    res.json({ codes, count: codes.length });
  } catch (err) {
    next(err);
  }
});

router.get('/cdk/list', adminAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = pageSize(req.query.pageSize);
    const status = req.query.status || '';
    const result = await cdkService.list({ status, page, pageSize: limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
