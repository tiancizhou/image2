const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminAuth = require('../middleware/admin-auth');
const db = require('../db/pool');
const config = require('../config');
const settingsService = require('../services/settings');
const pointsService = require('../services/points');
const cdkService = require('../services/cdk');
const channelsService = require('../services/channels');
const imageStorage = require('../services/image-storage');

const router = express.Router();
const upload = multer({ dest: 'uploads/tmp/' });

function pageSize(queryValue, fallback = 20, max = 50) {
  const value = parseInt(queryValue, 10) || fallback;
  return Math.min(Math.max(value, 1), max);
}

function parseDateInput(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${fieldName}格式不正确`);
    err.status = 400;
    throw err;
  }
  return date;
}

function collectGenerationFiles(rows) {
  const files = new Set();
  for (const row of rows) {
    for (const field of ['result_image_path', 'thumbnail_image_path', 'source_image_path']) {
      if (!row[field]) continue;
      String(row[field]).split(',').map(item => item.trim()).filter(Boolean).forEach(file => files.add(file));
    }
  }
  return files;
}

function hasGenerationFile(row, file) {
  return ['result_image_path', 'thumbnail_image_path', 'source_image_path'].some((field) => {
    if (!row[field]) return false;
    return String(row[field]).split(',').map(item => item.trim()).includes(file);
  });
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

router.delete('/generations/range', adminAuth, async (req, res, next) => {
  try {
    const startAt = parseDateInput(req.body.start_at, '开始时间');
    const endAt = parseDateInput(req.body.end_at, '结束时间');
    if (!startAt && !endAt) return res.status(400).json({ error: '请至少选择一个时间范围' });
    if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
      return res.status(400).json({ error: '开始时间不能晚于结束时间' });
    }

    const where = [];
    const params = [];
    if (startAt) {
      params.push(startAt);
      where.push(`created_at >= $${params.length}`);
    }
    if (endAt) {
      params.push(endAt);
      where.push(`created_at <= $${params.length}`);
    }

    const condition = where.join(' AND ');
    const { rows } = await db.query(
      `SELECT id, result_image_path, thumbnail_image_path, source_image_path
       FROM generations
       WHERE ${condition} AND status <> 'pending'`,
      params
    );
    const { rows: [{ count: skippedPending }] } = await db.query(
      `SELECT COUNT(*) FROM generations
       WHERE ${condition} AND status = 'pending'`,
      params
    );
    if (rows.length === 0) return res.json({ deleted: 0, files_deleted: 0, skipped_pending: Number(skippedPending) });

    const files = collectGenerationFiles(rows);
    await db.query(
      `DELETE FROM generations WHERE id = ANY($1::int[])`,
      [rows.map(row => row.id)]
    );
    let filesDeleted = 0;
    const remainingFiles = [...files];
    let referencedFiles = new Set();
    if (remainingFiles.length > 0) {
      const { rows: remainingRows } = await db.query(
        `SELECT result_image_path, thumbnail_image_path, source_image_path
         FROM generations
         WHERE result_image_path IS NOT NULL
            OR thumbnail_image_path IS NOT NULL
            OR source_image_path IS NOT NULL`
      );
      referencedFiles = new Set(remainingFiles.filter(file => remainingRows.some(row => hasGenerationFile(row, file))));
    }
    for (const file of files) {
      if (referencedFiles.has(file)) continue;
      imageStorage.deleteImage(file);
      filesDeleted += 1;
    }

    res.json({ deleted: rows.length, files_deleted: filesDeleted, skipped_pending: Number(skippedPending) });
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
      'review_mode',
      'community_title',
      'community_desc',
      'community_button_text',
      'community_image_url',
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

router.post('/settings/upload', adminAuth, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传图片' });
    const ext = path.extname(req.file.originalname || '.png') || '.png';
    const filename = `${Date.now()}-community-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const target = path.join(config.uploadDir, filename);
    fs.renameSync(req.file.path, target);
    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
