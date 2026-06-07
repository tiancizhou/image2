const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/pool');
const config = require('../config');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少 code' });

    const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wxAppId}&secret=${config.wxSecret}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await fetch(wxUrl);
    const wxData = await wxRes.json();

    if (wxData.errcode) {
      return res.status(400).json({ error: `微信登录失败: ${wxData.errmsg}` });
    }

    const { openid } = wxData;

    let user;
    const { rows } = await db.query('SELECT * FROM users WHERE openid = $1', [openid]);
    if (rows.length > 0) {
      user = rows[0];
      await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    } else {
      const insertRes = await db.query(
        'INSERT INTO users (openid) VALUES ($1) RETURNING *',
        [openid]
      );
      user = insertRes.rows[0];
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ token, user: { id: user.id, nickname: user.nickname, avatar_url: user.avatar_url, points: user.points } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
