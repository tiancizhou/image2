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
  try {
    const { result, channel } = job.type === 'img2img'
      ? await runImageEdit(job)
      : await runTextGenerate(job);

    const images = await persistImages(result);
    if (images.length === 0) throw new Error('中转站未返回图片');

    await pointsService.consume(
      job.user_id,
      job.points_cost,
      `${job.type === 'img2img' ? '图片编辑' : '文生图'} #${job.id}`
    );

    await db.query(
      `UPDATE generations
       SET status = $1, result_image_path = $2, channel_id = $3, error_message = NULL
       WHERE id = $4`,
      ['success', images.join(','), channel.id, job.id]
    );
  } catch (err) {
    await db.query(
      'UPDATE generations SET status = $1, error_message = $2 WHERE id = $3',
      ['failed', err.message, job.id]
    );
    throw err;
  }
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
