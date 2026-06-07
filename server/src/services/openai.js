const channels = require('./channels');

async function requestChannel(channel, endpoint, body, isMultipart = false) {
  const url = `${channel.base_url.replace(/\/+$/, '')}${endpoint}`;
  const headers = { Authorization: `Bearer ${channel.api_key}` };
  if (!isMultipart) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: isMultipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(channel.timeout_ms || 120000),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${channel.name} 返回错误 ${res.status}: ${text}`);
    err.status = 502;
    err.upstreamStatus = res.status;
    throw err;
  }

  return res.json();
}

async function withFailover(handler) {
  const candidates = await channels.getCandidates();
  if (candidates.length === 0) throw new Error('没有可用的中转站渠道，请先在管理端配置并启用渠道');

  const errors = [];
  for (const channel of candidates) {
    try {
      const data = await handler(channel);
      await channels.markSuccess(channel.id);
      return { data, channel };
    } catch (err) {
      errors.push(err.message);
      await channels.markFailure(channel, err);
    }
  }

  const err = new Error(`所有中转站渠道均不可用: ${errors.join(' | ')}`);
  err.status = 502;
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
