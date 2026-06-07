const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db/pool');
const pointsService = require('../services/points');
const cdkService = require('../services/cdk');
const checkinService = require('../services/checkin');

const router = express.Router();

router.get('/profile', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nickname, avatar_url, points, consecutive_checkins, last_checkin_date, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/points', auth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const result = await pointsService.getLogs(req.userId, page, pageSize);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/cdk/redeem', auth, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '请输入兑换码' });
    const result = await cdkService.redeem(code.trim().toUpperCase(), req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/checkin', auth, async (req, res, next) => {
  try {
    const result = await checkinService.checkin(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/checkin/status', auth, async (req, res, next) => {
  try {
    const result = await checkinService.getStatus(req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
