const fs = require('fs');
const path = require('path');
const db = require('../db/pool');
const openai = require('./openai');
const imageStorage = require('./image-storage');
const pointsService = require('./points');

const queue = [];
let running = false;

function enqueue(job) {
  queue.push(job);
  console.log(`[Worker] enqueue generation=${job.id} type=${job.type} model=${job.model} size=${job.size} queue=${queue.length}`);
  setImmediate(processQueue);
}

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      await runJob(job);
    } catch (err) {
      console.error(`[Worker] generation ${job.id} failed:`, err.message);
    }
  }
  running = false;
}

async function restorePendingJobs() {
  const { rows } = await db.query(
    `SELECT id, user_id, type, prompt, model, size, source_image_path, points_cost
     FROM generations
     WHERE status = 'pending'
     ORDER BY id ASC`
  );
  for (const row of rows) enqueue(row);
  if (rows.length > 0) console.log(`Restored ${rows.length} pending generation job(s)`);
}

async function runJob(job) {
  const startedAt = Date.now();
  console.log(`[Worker] start generation=${job.id} type=${job.type} model=${job.model} size=${job.size}`);
  try {
    await ensureReservedPoints(job);

    const { result, channel } = job.type === 'img2img'
      ? await runImageEdit(job)
      : await runTextGenerate(job);

    const images = await persistImages(result);
    if (images.length === 0) throw new Error('中转站未返回图片');

    await db.query(
      `UPDATE generations
       SET status = $1, result_image_path = $2, channel_id = $3, error_message = NULL
       WHERE id = $4`,
      ['success', images.join(','), channel.id, job.id]
    );
    console.log(`[Worker] success generation=${job.id} channel=${channel.name} images=${images.length} cost=${job.points_cost} duration=${Date.now() - startedAt}ms`);
  } catch (err) {
    await db.query(
      'UPDATE generations SET status = $1, error_message = $2, channel_id = COALESCE($3, channel_id) WHERE id = $4',
      ['failed', err.message, err.channelId || null, job.id]
    );
    await refundReservedPoints(job);
    console.error(`[Worker] failed generation=${job.id} duration=${Date.now() - startedAt}ms error=${err.message}`);
    throw err;
  }
}

async function ensureReservedPoints(job) {
  if (!job.points_cost || job.points_cost <= 0) return;
  if (await hasPointLog(job, 'consume', reserveRemark(job))) return;

  await pointsService.consume(
    job.user_id,
    job.points_cost,
    reserveRemark(job)
  );
}

async function refundReservedPoints(job) {
  if (!job.points_cost || job.points_cost <= 0) return;
  if (!await hasPointLog(job, 'consume', reserveRemark(job))) return;

  if (await hasPointLog(job, 'refund', refundRemark(job))) return;

  await pointsService.add(
    job.user_id,
    job.points_cost,
    'refund',
    refundRemark(job)
  );
}

async function hasPointLog(job, type, remark) {
  const { rows } = await db.query(
    `SELECT id FROM point_logs
     WHERE user_id = $1 AND type = $2 AND remark = $3
     LIMIT 1`,
    [job.user_id, type, remark]
  );
  return rows.length > 0;
}

function reserveRemark(job) {
  return `生成任务冻结: ${generationLabel(job.type)} #${job.id}`;
}

function refundRemark(job) {
  return `生成失败返还: ${generationLabel(job.type)} #${job.id}`;
}

function generationLabel(type) {
  return type === 'img2img' ? '图生图' : '文生图';
}

async function runTextGenerate(job) {
  const { data, channel } = await openai.generateImage({
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    n: 1,
  });
  return { result: data, channel };
}

async function runImageEdit(job) {
  const imagePath = path.join('uploads', job.source_image_path);
  if (!job.source_image_path || !fs.existsSync(imagePath)) {
    throw new Error(`参考图文件不存在或已丢失: ${job.source_image_path || '-'}`);
  }
  const imageBuffer = fs.readFileSync(imagePath);
  const { data, channel } = await openai.editImage({
    prompt: job.prompt,
    model: job.model,
    n: 1,
    imageBuffer,
    filename: path.basename(job.source_image_path),
  });
  return { result: data, channel };
}

async function persistImages(result) {
  const images = [];
  for (const item of (result.data || [])) {
    if (item.b64_json) {
      images.push(imageStorage.saveBase64Image(item.b64_json));
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      fs.writeFileSync(path.join('uploads', filename), buffer);
      images.push(filename);
    }
  }
  return images;
}

module.exports = { enqueue, restorePendingJobs };
