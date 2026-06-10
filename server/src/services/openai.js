const channels = require('./channels');

const RETRYABLE_UPSTREAM_STATUSES = new Set([502]);
const MAX_FAST_CHANNEL_ATTEMPTS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  if (err.upstreamStatus && RETRYABLE_UPSTREAM_STATUSES.has(err.upstreamStatus)) return true;
  return false;
}

function retryDelayMs(attempt) {
  return Math.min(400 * attempt, 1600);
}

async function requestChannel(channel, endpoint, body, isMultipart = false) {
  const rawPrefix = channel.api_prefix === null || channel.api_prefix === undefined ? '/v1' : channel.api_prefix;
  const apiPrefix = rawPrefix ? `/${String(rawPrefix).replace(/^\/+|\/+$/g, '')}` : '';
  const url = `${channel.base_url.replace(/\/+$/, '')}${apiPrefix}${endpoint}`;
  const headers = { Authorization: `Bearer ${channel.api_key}` };
  if (!isMultipart) headers['Content-Type'] = 'application/json';

  const startedAt = Date.now();
  const timeoutMs = channel.timeout_ms || 120000;
  console.log(`[OpenAI] channel=${channel.name} id=${channel.id} POST ${url} timeout=${timeoutMs}ms`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: isMultipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    err.message = `${channel.name} 请求失败 ${Date.now() - startedAt}ms: ${err.message}`;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok) {
    const err = new Error(`${channel.name} 返回错误 ${res.status}: ${text.slice(0, 1000)}`);
    err.status = 502;
    err.upstreamStatus = res.status;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }

  console.log(`[OpenAI] channel=${channel.name} id=${channel.id} OK ${res.status} ${Date.now() - startedAt}ms`);
  if (!contentType.toLowerCase().includes('application/json')) {
    const err = new Error(`${channel.name} 返回非 JSON 响应 ${res.status} ${contentType || 'unknown'}: ${text.slice(0, 300)}`);
    err.status = 502;
    err.upstreamStatus = 502;
    err.badResponse = true;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch (parseErr) {
    const err = new Error(`${channel.name} 返回 JSON 解析失败: ${parseErr.message}; body=${text.slice(0, 300)}`);
    err.status = 502;
    err.upstreamStatus = 502;
    err.badResponse = true;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }
}

async function requestChannelWithRetry(channel, handler) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_FAST_CHANNEL_ATTEMPTS; attempt += 1) {
    try {
      return await handler(channel);
    } catch (err) {
      lastErr = err;
      const maxAttempts = MAX_FAST_CHANNEL_ATTEMPTS;
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      console.log(`[OpenAI] channel=${channel.name} id=${channel.id} retry=${attempt + 1}/${maxAttempts}`);
      await sleep(retryDelayMs(attempt));
    }
  }
  throw lastErr;
}

async function withFailover(handler) {
  const candidates = await channels.getCandidates();
  if (candidates.length === 0) throw new Error('没有可用的中转站渠道，请先在管理端配置并启用渠道');
  console.log(`[OpenAI] candidates=${candidates.map(c => `${c.id}:${c.name}`).join(', ')}`);

  const errors = [];
  let lastChannel = null;
  for (const channel of candidates) {
    lastChannel = channel;
    try {
      const data = await requestChannelWithRetry(channel, handler);
      await channels.markSuccess(channel.id);
      return { data, channel };
    } catch (err) {
      console.error(`[OpenAI] channel=${channel.name} id=${channel.id} failed: ${err.message}`);
      errors.push(err.message);
      await channels.markFailure(channel, err);
    }
  }

  const err = new Error(`所有中转站渠道均不可用: ${errors.join(' | ')}`);
  err.status = 502;
  if (lastChannel) {
    err.channelId = lastChannel.id;
    err.channelName = lastChannel.name;
  }
  throw err;
}

async function generateImage({ prompt, model, size, n }) {
  return withFailover(async (channel) => requestChannel(
    channel,
    '/images/generations',
    { model, prompt, n: n || 1, size },
    false
  ));
}

async function editImage({ prompt, model, size, n, imageBuffer, filename }) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  if (size) formData.append('size', size);
  formData.append('n', String(n || 1));
  formData.append('image', new Blob([imageBuffer]), filename);

  return withFailover(async (channel) => requestChannel(channel, '/images/edits', formData, true));
}

module.exports = { generateImage, editImage };
