const fs = require('fs');
const path = require('path');
const db = require('../db/pool');
const openai = require('./openai');
const imageStorage = require('./image-storage');
const pointsService = require('./points');

const queue = [];
const WORKER_CONCURRENCY = Number.parseInt(process.env.GENERATION_WORKER_CONCURRENCY || '2', 10);
let runningCount = 0;

function enqueue(job) {
  queue.push(job);
  console.log(`[Worker] enqueue generation=${job.id} type=${job.type} model=${job.model} size=${job.size} queue=${queue.length}`);
  setImmediate(processQueue);
}

async function processQueue() {
  while (runningCount < WORKER_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    runningCount += 1;
    runJob(job)
      .catch((err) => {
        console.error(`[Worker] generation ${job.id} failed:`, err.message);
      })
      .finally(() => {
        runningCount -= 1;
        setImmediate(processQueue);
      });
  }
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

    const persisted = await persistImages(result);
    if (persisted.images.length === 0) {
      const err = new Error(`中转站未返回图片: ${summarizeImageResponse(result)}`);
      err.channelId = channel.id;
      err.channelName = channel.name;
      throw err;
    }

    await db.query(
      `UPDATE generations
       SET status = $1, result_image_path = $2, thumbnail_image_path = $3, channel_id = $4, error_message = NULL
       WHERE id = $5`,
      [ 'success', persisted.images.join(','), persisted.thumbnails.join(','), channel.id, job.id ]
    );
    console.log(`[Worker] success generation=${job.id} channel=${channel.name} images=${persisted.images.length} cost=${job.points_cost} duration=${Date.now() - startedAt}ms`);
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
    size: job.size,
    n: 1,
    imageBuffer,
    filename: path.basename(job.source_image_path),
  });
  return { result: data, channel };
}

async function persistImages(result) {
  const images = [];
  const thumbnails = [];
  for (const item of collectImagePayloads(result)) {
    if (item.b64) {
      const saved = imageStorage.saveBase64Image(item.b64);
      images.push(saved.filename);
      thumbnails.push(saved.thumbnail || saved.filename);
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const ext = path.extname(new URL(item.url).pathname) || '.png';
      const saved = imageStorage.saveImageBuffer(buffer, ext);
      images.push(saved.filename);
      thumbnails.push(saved.thumbnail || saved.filename);
    }
  }
  return { images, thumbnails };
}

function collectImagePayloads(result) {
  const payloads = [];
  const seen = new Set();

  function add(value) {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (seen.has(trimmed)) return;

    const dataUrl = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (dataUrl) {
      seen.add(trimmed);
      payloads.push({ b64: dataUrl[1] });
      return;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      seen.add(trimmed);
      payloads.push({ url: trimmed });
      return;
    }

    if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 200) {
      seen.add(trimmed);
      payloads.push({ b64: trimmed });
    }
  }

  function visit(value) {
    if (!value) return;
    if (typeof value === 'string') {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;

    add(value.b64_json);
    add(value.b64);
    add(value.base64);
    add(value.image_base64);
    add(value.url);
    add(value.image_url);
    add(value.data_url);

    if (value.image_url && typeof value.image_url === 'object') visit(value.image_url);
    if (value.image && typeof value.image === 'object') visit(value.image);
    if (value.data) visit(value.data);
    if (value.output) visit(value.output);
    if (value.content) visit(value.content);
    if (value.images) visit(value.images);
  }

  visit(result);
  return payloads;
}

function summarizeImageResponse(result) {
  if (!result || typeof result !== 'object') return '响应为空或格式异常';
  const keys = Object.keys(result).slice(0, 8).join(',');
  const dataInfo = Array.isArray(result.data) ? `data.length=${result.data.length}` : 'data=none';
  const outputInfo = Array.isArray(result.output) ? `output.length=${result.output.length}` : 'output=none';
  const error = result.error?.message ? ` error=${String(result.error.message).slice(0, 120)}` : '';
  return `keys=${keys || '-'} ${dataInfo} ${outputInfo}${error}`;
}

module.exports = { enqueue, restorePendingJobs };
