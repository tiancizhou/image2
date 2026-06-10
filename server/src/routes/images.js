const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const db = require('../db/pool');
const settings = require('../services/settings');
const imageStorage = require('../services/image-storage');
const generationWorker = require('../services/generation-worker');
const generationPricing = require('../services/generation-pricing');

const upload = multer({ dest: 'uploads/tmp/' });
const router = express.Router();

const VALID_SIZES = ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '3840x2160'];

function generationLabel(type) {
  return type === 'img2img' ? '图生图' : '文生图';
}

async function hasEnabledChannels() {
  const { rows } = await db.query(
    `SELECT 1 FROM api_channels
     WHERE enabled = TRUE
       AND (circuit_status <> 'open' OR circuit_open_until IS NULL OR circuit_open_until <= NOW())
     LIMIT 1`
  );
  return rows.length > 0;
}

async function createGenerationAndReservePoints({ userId, type, prompt, model, size, sourceImagePath, cost }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT points FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const currentPoints = rows[0]?.points ?? 0;
    if (currentPoints < cost) {
      const err = new Error('积分不足');
      err.status = 400;
      throw err;
    }

    const { rows: [gen] } = await client.query(
      `INSERT INTO generations (user_id, type, prompt, model, size, source_image_path, points_cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [userId, type, prompt, model, size, sourceImagePath || null, cost]
    );

    const balanceAfter = currentPoints - cost;
    await client.query(
      'UPDATE users SET points = $1 WHERE id = $2',
      [balanceAfter, userId]
    );
    await client.query(
      `INSERT INTO point_logs (user_id, type, amount, balance_after, remark)
       VALUES ($1, 'consume', $2, $3, $4)`,
      [userId, -cost, balanceAfter, `生成任务冻结: ${generationLabel(type)} #${gen.id}`]
    );

    await client.query('COMMIT');
    return gen;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.get('/availability', async (req, res, next) => {
  try {
    const available = await hasEnabledChannels();
    res.json({
      available,
      mode: available ? 'creative' : 'gallery',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/pricing', async (req, res, next) => {
  try {
    res.json(await generationPricing.getPricingTable());
  } catch (err) {
    next(err);
  }
});

router.post('/generate', auth, async (req, res, next) => {
  try {
    if (!await hasEnabledChannels()) return res.status(503).json({ error: '创作服务暂未开放' });
    const { prompt, model, size } = req.body;
    if (!prompt) return res.status(400).json({ error: '请输入提示词' });
    if (size && !VALID_SIZES.includes(size)) return res.status(400).json({ error: '不支持的尺寸' });

    const useModel = model || await settings.get('default_model') || 'gpt-image-2';
    const useSize = size || '1024x1024';
    const cost = await generationPricing.getCostForSize(useSize);

    const gen = await createGenerationAndReservePoints({
      userId: req.userId,
      type: 'text2img',
      prompt,
      model: useModel,
      size: useSize,
      cost,
    });

    generationWorker.enqueue(gen);
    res.status(202).json({ id: gen.id, status: 'pending', points_cost: cost });
  } catch (err) {
    next(err);
  }
});

router.post('/edit', auth, upload.single('image'), async (req, res, next) => {
  let sourceFilename = null;
  try {
    if (!await hasEnabledChannels()) return res.status(503).json({ error: '创作服务暂未开放' });
    const { prompt, model, size, source_generation_id } = req.body;
    if (!prompt) return res.status(400).json({ error: '请输入提示词' });
    if (!req.file && !source_generation_id) return res.status(400).json({ error: '请上传图片' });
    if (size && !VALID_SIZES.includes(size)) return res.status(400).json({ error: '不支持的尺寸' });

    const useModel = model || await settings.get('default_model') || 'gpt-image-2';
    const useSize = size || '1024x1024';
    const cost = await generationPricing.getCostForSize(useSize);

    if (source_generation_id) {
      const { rows } = await db.query(
        `SELECT result_image_path FROM generations
         WHERE id = $1 AND user_id = $2 AND status = 'success' AND result_image_path IS NOT NULL`,
        [source_generation_id, req.userId]
      );
      if (rows.length === 0) return res.status(400).json({ error: '参考图记录不存在或未生成完成' });
      sourceFilename = String(rows[0].result_image_path).split(',')[0].trim();
    } else {
      sourceFilename = `${Date.now()}-source-${Math.random().toString(36).slice(2, 8)}${path.extname(req.file.originalname || '.png')}`;
      fs.renameSync(req.file.path, path.join('uploads', sourceFilename));
    }

    const gen = await createGenerationAndReservePoints({
      userId: req.userId,
      type: 'img2img',
      prompt,
      model: useModel,
      size: useSize,
      sourceImagePath: sourceFilename,
      cost,
    });

    generationWorker.enqueue(gen);
    res.status(202).json({ id: gen.id, status: 'pending', points_cost: cost });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (sourceFilename && req.file) {
      imageStorage.deleteImage(sourceFilename);
    }
    next(err);
  }
});

router.get('/history', auth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const { rows } = await db.query(
      `SELECT id, type, prompt, model, size, result_image_path, points_cost, status, error_message, created_at
       FROM generations WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.userId, pageSize, offset]
    );
    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM generations WHERE user_id = $1`,
      [req.userId]
    );

    res.json({ list: rows, total: parseInt(count), page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/share/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, type, prompt, model, size, result_image_path, status, created_at
       FROM generations
       WHERE id = $1 AND status = 'success' AND result_image_path IS NOT NULL`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '分享内容不存在或尚未生成完成' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/retry', auth, async (req, res, next) => {
  try {
    if (!await hasEnabledChannels()) return res.status(503).json({ error: '创作服务暂未开放' });

    const { rows } = await db.query(
      `SELECT id, type, prompt, model, size, source_image_path, status
       FROM generations
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });

    const original = rows[0];
    if (original.status !== 'failed') return res.status(400).json({ error: '只有失败记录可以重试' });
    if (original.type === 'img2img' && !original.source_image_path) {
      return res.status(400).json({ error: '原参考图已丢失，无法重试' });
    }
    if (original.type === 'img2img' && !fs.existsSync(path.join('uploads', original.source_image_path))) {
      return res.status(400).json({ error: '原参考图文件已丢失，无法重试' });
    }

    const cost = await generationPricing.getCostForSize(original.size);
    const gen = await createGenerationAndReservePoints({
      userId: req.userId,
      type: original.type,
      prompt: original.prompt,
      model: original.model,
      size: original.size,
      sourceImagePath: original.source_image_path,
      cost,
    });

    generationWorker.enqueue(gen);
    res.status(202).json({ id: gen.id, status: 'pending', points_cost: cost });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM generations WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT result_image_path, source_image_path FROM generations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' });

    const gen = rows[0];
    if (gen.result_image_path) {
      for (const f of gen.result_image_path.split(',')) {
        imageStorage.deleteImage(f.trim());
      }
    }
    if (gen.source_image_path) {
      imageStorage.deleteImage(gen.source_image_path);
    }

    await db.query('DELETE FROM generations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
