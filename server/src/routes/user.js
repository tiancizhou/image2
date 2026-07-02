const express = require('express');
const auth = require('../middleware/auth');
const db = require('../db/pool');
const pointsService = require('../services/points');
const cdkService = require('../services/cdk');
const checkinService = require('../services/checkin');
const invitations = require('../services/invitations');
const settingsService = require('../services/settings');

const router = express.Router();

function intSetting(settings, key, fallback) {
  const value = Number.parseInt(settings[key], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

router.get('/public-config', async (req, res, next) => {
  try {
    const all = await settingsService.getAll();
    res.json({
      reviewMode: all.review_mode === 'true',
      rewardAdPoints: intSetting(all, 'reward_ad_points', 1),
      community: {
        title: all.community_title || '加入梦倩绘境交流群',
        desc: all.community_desc || '添加作者微信，进群领取积分福利，交流提示词和画面审美参考。',
        buttonText: all.community_button_text || '查看名片码',
        imageUrl: all.community_image_url || '/static/author-wechat-card.jpg',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/profile', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nickname, avatar_url, points, consecutive_checkins, last_checkin_date, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({ ...rows[0], invite_code: invitations.publicInviteCode(rows[0].id) });
  } catch (err) {
    next(err);
  }
});

router.get('/profile/summary', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nickname, avatar_url, points, consecutive_checkins, last_checkin_date, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });

    const checkin = await checkinService.getStatus(req.userId);
    res.json({
      profile: { ...rows[0], invite_code: invitations.publicInviteCode(rows[0].id) },
      checkin,
    });
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

router.post('/reward-ad', auth, async (req, res, next) => {
  try {
    const all = await settingsService.getAll();
    const result = await pointsService.rewardAd(req.userId, intSetting(all, 'reward_ad_points', 1));
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
