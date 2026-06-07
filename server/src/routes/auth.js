const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db/pool');
const config = require('../config');

const router = express.Router();

function publicUser(user) {
  return { id: user.id, nickname: user.nickname, avatar_url: user.avatar_url, points: user.points };
}

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
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/web-login/session', async (req, res, next) => {
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresInSeconds = 300;
    await db.query(
      `INSERT INTO web_login_sessions (token, expires_at)
       VALUES ($1, NOW() + ($2 || ' seconds')::interval)`,
      [token, expiresInSeconds]
    );

    const qrImage = await createMiniProgramCode(token);
    res.json({
      token,
      expires_in: expiresInSeconds,
      qr_image: qrImage,
      page: 'pages/web-login/web-login',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/web-login/status', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: '无效登录会话' });

    const { rows } = await db.query(
      `SELECT s.status, s.user_id, s.expires_at, u.id AS user_id_value, u.nickname, u.avatar_url, u.points
       FROM web_login_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: '登录会话不存在' });

    const session = rows[0];
    if (new Date(session.expires_at).getTime() < Date.now() && session.status !== 'confirmed') {
      return res.json({ status: 'expired' });
    }
    if (session.status !== 'confirmed' || !session.user_id) {
      return res.json({ status: session.status });
    }

    const user = {
      id: session.user_id_value,
      nickname: session.nickname,
      avatar_url: session.avatar_url,
      points: session.points,
    };
    const authToken = jwt.sign({ userId: session.user_id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ status: 'confirmed', token: authToken, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/web-login/confirm', async (req, res, next) => {
  try {
    const { token, code } = req.body;
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return res.status(400).json({ error: '无效登录会话' });
    if (!code) return res.status(400).json({ error: '缺少 code' });

    const { rows: sessions } = await db.query(
      `SELECT token, status, expires_at FROM web_login_sessions WHERE token = $1`,
      [token]
    );
    if (sessions.length === 0) return res.status(404).json({ error: '登录会话不存在' });
    if (new Date(sessions[0].expires_at).getTime() < Date.now()) return res.status(400).json({ error: '登录二维码已过期' });

    const user = await getOrCreateWxUser(code);
    await db.query(
      `UPDATE web_login_sessions
       SET status = 'confirmed', user_id = $1, confirmed_at = NOW()
       WHERE token = $2`,
      [user.id, token]
    );

    const authToken = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ success: true, token: authToken, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

async function getOrCreateWxUser(code) {
  const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wxAppId}&secret=${config.wxSecret}&js_code=${code}&grant_type=authorization_code`;
  const wxRes = await fetch(wxUrl);
  const wxData = await wxRes.json();

  if (wxData.errcode) {
    const err = new Error(`微信登录失败: ${wxData.errmsg}`);
    err.status = 400;
    throw err;
  }

  const { openid } = wxData;
  const { rows } = await db.query('SELECT * FROM users WHERE openid = $1', [openid]);
  if (rows.length > 0) {
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [rows[0].id]);
    return rows[0];
  }

  const insertRes = await db.query(
    'INSERT INTO users (openid) VALUES ($1) RETURNING *',
    [openid]
  );
  return insertRes.rows[0];
}

async function createMiniProgramCode(token) {
  const accessToken = await getWxAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: token,
      page: 'pages/web-login/web-login',
      check_path: false,
      env_version: 'release',
      width: 320,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    const err = new Error(`小程序码生成失败: ${data.errmsg || data.errcode}`);
    err.status = 502;
    throw err;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function getWxAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.wxAppId}&secret=${config.wxSecret}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!data.access_token) {
    const err = new Error(`获取微信 access_token 失败: ${data.errmsg || data.errcode}`);
    err.status = 502;
    throw err;
  }
  return data.access_token;
}

module.exports = router;
