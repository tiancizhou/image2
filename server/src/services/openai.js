const channels = require('./channels');

async function requestChannel(channel, endpoint, body, isMultipart = false) {
  const url = `${channel.base_url.replace(/\/+$/, '')}${endpoint}`;
  const headers = { Authorization: `Bearer ${channel.api_key}` };
  if (!isMultipart) headers['Content-Type'] = 'application/json';

  const startedAt = Date.now();
  console.log(`[OpenAI] channel=${channel.name} id=${channel.id} POST ${url} timeout=${channel.timeout_ms || 120000}ms`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: isMultipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(channel.timeout_ms || 120000),
    });
  } catch (err) {
    err.message = `${channel.name} 请求失败 ${Date.now() - startedAt}ms: ${err.message}`;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${channel.name} 返回错误 ${res.status}: ${text}`);
    err.status = 502;
    err.upstreamStatus = res.status;
    err.channelId = channel.id;
    err.channelName = channel.name;
    throw err;
  }

  console.log(`[OpenAI] channel=${channel.name} id=${channel.id} OK ${res.status} ${Date.now() - startedAt}ms`);
  return res.json();
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
      const data = await handler(channel);
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
    '/v1/images/generations',
    { model, prompt, n: n || 1, size }
  ));
}

async function editImage({ prompt, model, n, imageBuffer, filename }) {
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('n', String(n || 1));
  formData.append('image', new Blob([imageBuffer]), filename);

  return withFailover(async (channel) => requestChannel(channel, '/v1/images/edits', formData, true));
}

module.exports = { generateImage, editImage };
