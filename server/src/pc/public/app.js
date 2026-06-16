const state = {
  token: localStorage.getItem('mq_pc_token') || '',
  user: null,
  webLoginToken: '',
  pollTimer: null,
  mode: 'text2img',
  historyPage: 1,
  historyTotal: 0,
  historyList: [],
  loading: false,
  pricing: {
    '1024x1024': 1,
    '1536x1024': 2,
    '1024x1536': 2,
    '2048x2048': 2,
    '3840x2160': 4,
  },
};

const els = {
  navItems: document.querySelectorAll('.nav-item'),
  views: {
    create: document.getElementById('createView'),
    history: document.getElementById('historyView'),
    account: document.getElementById('accountView'),
  },
  userName: document.getElementById('userName'),
  userPoints: document.getElementById('userPoints'),
  accountPoints: document.getElementById('accountPoints'),
  sessionText: document.getElementById('sessionText'),
  authPanel: document.getElementById('authPanel'),
  newQrBtn: document.getElementById('newQrBtn'),
  qrImage: document.getElementById('qrImage'),
  qrStatus: document.getElementById('qrStatus'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  uploadBox: document.getElementById('uploadBox'),
  imageInput: document.getElementById('imageInput'),
  fileName: document.getElementById('fileName'),
  createForm: document.getElementById('createForm'),
  promptInput: document.getElementById('promptInput'),
  promptCount: document.getElementById('promptCount'),
  sizeSelect: document.getElementById('sizeSelect'),
  currentCost: document.getElementById('currentCost'),
  modelInput: document.getElementById('modelInput'),
  submitBtn: document.getElementById('submitBtn'),
  taskTitle: document.getElementById('taskTitle'),
  taskDesc: document.getElementById('taskDesc'),
  taskBox: document.getElementById('taskBox'),
  historyGrid: document.getElementById('historyGrid'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  toast: document.getElementById('toast'),
  detailModal: document.getElementById('detailModal'),
  detailBody: document.getElementById('detailBody'),
  cdkForm: document.getElementById('cdkForm'),
  cdkInput: document.getElementById('cdkInput'),
  checkinBtn: document.getElementById('checkinBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pointsList: document.getElementById('pointsList'),
};

init().catch(err => {
  console.error(err);
  toast(err.message || '初始化失败');
});

async function init() {
  bindEvents();
  await loadPricing();
  if (state.token) {
    try {
      await loadProfile();
    } catch {
      logoutWeb();
    }
  }
  renderAuthState();
  if (isLoggedIn()) await refreshAll(false);
  else await createWebLoginSession();
}

function bindEvents() {
  els.navItems.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  els.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  els.imageInput.addEventListener('change', () => {
    const files = Array.from(els.imageInput.files || []).slice(0, 4);
    els.fileName.textContent = files.length
      ? files.map(file => file.name).join('、')
      : '最多选择 4 张图片作为再创作基础';
  });
  els.promptInput.addEventListener('input', updatePromptCount);
  els.sizeSelect.addEventListener('change', updateSelectedCost);
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPromptTemplate(btn.dataset.prompt));
  });
  els.createForm.addEventListener('submit', onSubmitCreate);
  document.getElementById('refreshBtn').addEventListener('click', () => refreshAll(true));
  document.getElementById('historyBtn').addEventListener('click', () => switchView('history'));
  document.getElementById('loadHistoryBtn').addEventListener('click', () => loadHistory(true));
  els.newQrBtn.addEventListener('click', createWebLoginSession);
  els.loadMoreBtn.addEventListener('click', () => loadHistory(false));
  els.cdkForm.addEventListener('submit', onRedeemCdk);
  els.checkinBtn.addEventListener('click', onCheckin);
  els.logoutBtn.addEventListener('click', onLogout);
  document.querySelectorAll('[data-close="detail"]').forEach(el => {
    el.addEventListener('click', closeDetail);
  });
}

async function loadPricing() {
  try {
    const pricing = await api('/api/images/pricing', { auth: false });
    Object.keys(pricing.sizes || {}).forEach((size) => {
      state.pricing[size] = pricing.sizes[size].points_cost;
    });
    renderSizeOptions();
    updateSelectedCost();
  } catch (err) {
    updateSelectedCost();
  }
}

function renderSizeOptions() {
  const labels = {
    '1024x1024': '方图 1024x1024',
    '1536x1024': '横图 1536x1024',
    '1024x1536': '竖图 1024x1536',
    '2048x2048': '高清方图 2048x2048',
    '3840x2160': '宽屏 3840x2160',
  };
  const current = els.sizeSelect.value || '1024x1024';
  els.sizeSelect.innerHTML = Object.keys(labels).map((size) => {
    const selected = size === current ? ' selected' : '';
    return `<option value="${size}"${selected}>${labels[size]} · ${getCostForSize(size)} 积分</option>`;
  }).join('');
}

function getCostForSize(size) {
  return state.pricing[size] !== undefined ? state.pricing[size] : 1;
}

function updateSelectedCost() {
  if (els.currentCost) els.currentCost.textContent = getCostForSize(els.sizeSelect.value);
}

function switchView(view) {
  els.navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  Object.entries(els.views).forEach(([key, el]) => el.classList.toggle('hidden', key !== view));
  if (!isLoggedIn()) return;
  if (view === 'history') loadHistory(true);
  if (view === 'account') {
    loadProfile();
    loadPointLogs();
  }
}

function setMode(mode) {
  state.mode = mode;
  els.modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  els.uploadBox.classList.toggle('hidden', mode !== 'img2img');
  els.submitBtn.textContent = mode === 'img2img' ? '上传并生成' : '开始生成';
  els.taskTitle.textContent = mode === 'img2img' ? '让一张旧图长出新方向' : '先写下你想看的画面';
  els.taskDesc.textContent = mode === 'img2img'
    ? '上传参考图，再描述想保留和想改变的部分。'
    : '描述主体、氛围、镜头、颜色和细节，结果会更稳定。';
}

function applyPromptTemplate(text) {
  els.promptInput.value = text || '';
  updatePromptCount();
  els.promptInput.focus();
}

function updatePromptCount() {
  const length = els.promptInput.value.trim().length;
  els.promptCount.textContent = `${length} 字`;
  els.promptCount.classList.toggle('strong', length >= 20);
}

async function createWebLoginSession() {
  stopPolling();
  els.qrImage.removeAttribute('src');
  els.qrStatus.textContent = '正在生成小程序码...';
  els.sessionText.textContent = '正在生成登录码';
  try {
    const data = await api('/api/auth/web-login/session', { method: 'POST', auth: false });
    state.webLoginToken = data.token;
    els.qrImage.src = data.qr_image;
    els.qrStatus.textContent = '请用微信扫码打开小程序确认登录';
    els.sessionText.textContent = '等待微信扫码';
    startPolling();
  } catch (err) {
    els.qrStatus.textContent = err.message || '小程序码生成失败，请稍后重试';
    toast(els.qrStatus.textContent);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(checkWebLoginStatus, 1800);
  checkWebLoginStatus();
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function checkWebLoginStatus() {
  if (!state.webLoginToken) return;
  let data;
  try {
    data = await api(`/api/auth/web-login/status?token=${state.webLoginToken}`, { auth: false });
  } catch (err) {
    els.qrStatus.textContent = err.message || '登录状态查询失败';
    return;
  }
  if (data.status === 'pending') {
    els.qrStatus.textContent = '等待微信扫码确认...';
    els.sessionText.textContent = '等待微信扫码';
    return;
  }
  if (data.status === 'expired') {
    stopPolling();
    els.qrStatus.textContent = '小程序码已过期，请刷新';
    els.sessionText.textContent = '登录码已过期';
    return;
  }
  if (data.status === 'confirmed') {
    stopPolling();
    applyWebAuth(data);
    await refreshAll(false);
    els.sessionText.textContent = '已登录';
    toast('登录成功，已进入 PC 创作台');
  }
}

function applyWebAuth(data) {
  state.token = data.token;
  localStorage.setItem('mq_pc_token', state.token);
  state.user = data.user;
  renderAuthState();
}

function logoutWeb() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('mq_pc_token');
}

function isLoggedIn() {
  return Boolean(state.token && state.user);
}

function renderAuthState() {
  const loggedIn = isLoggedIn();
  els.authPanel.classList.toggle('hidden', loggedIn);
  els.createForm.classList.toggle('locked', !loggedIn);
  els.userName.textContent = loggedIn ? (state.user.nickname || `绘境用户 #${state.user.id}`) : '微信扫码登录';
  els.userPoints.textContent = loggedIn ? (state.user.points ?? 0) : '--';
  els.accountPoints.textContent = loggedIn ? (state.user.points ?? 0) : '--';
  els.sessionText.textContent = loggedIn ? '已连接小程序账号' : '等待扫码登录';
  if (!loggedIn) {
    els.historyGrid.innerHTML = '<div class="task-box">微信扫码登录后，才能查看你的创作历史。</div>';
    els.pointsList.innerHTML = '<div class="points-row"><span>微信扫码登录后显示积分记录。</span></div>';
  }
}

async function api(url, options = {}) {
  const headers = options.headers || {};
  if (options.auth !== false) headers.Authorization = `Bearer ${state.token}`;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
  });

  const data = await parseJson(res);
  if (res.status === 401 && options.auth !== false) {
    localStorage.removeItem('mq_pc_token');
    logoutWeb();
    renderAuthState();
    throw new Error('请先微信扫码登录');
  }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function parseJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function loadProfile() {
  if (!isLoggedIn()) return;
  const user = await api('/api/user/profile');
  state.user = user;
  renderUser();
}

function renderUser() {
  const user = state.user;
  if (!user) return;
  els.userName.textContent = user.nickname || `绘境用户 #${user.id}`;
  els.userPoints.textContent = user.points ?? 0;
  els.accountPoints.textContent = user.points ?? 0;
}

async function onSubmitCreate(event) {
  event.preventDefault();
  if (!isLoggedIn()) {
    toast('请先微信扫码登录');
    return;
  }
  if (state.loading) return;

  const prompt = els.promptInput.value.trim();
  if (!prompt) {
    toast('请输入创作描述');
    return;
  }
  if (state.mode === 'img2img' && !els.imageInput.files[0]) {
    toast('请先选择参考图片');
    return;
  }

  state.loading = true;
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = '提交中...';
  try {
    const payload = {
      prompt,
      model: els.modelInput.value.trim() || 'gpt-image-2',
      size: els.sizeSelect.value,
    };
    const result = state.mode === 'img2img'
      ? await submitImageEdit(payload)
      : await submitTextGenerate(payload);

    els.taskTitle.textContent = '任务已进入队列';
    els.taskDesc.textContent = '你可以继续创作，也可以去历史列表等待完成。';
    els.taskBox.classList.remove('hidden');
    els.taskBox.innerHTML = `任务 #${result.id} · 已冻结 ${result.points_cost} 积分`;
    els.promptInput.value = '';
    updatePromptCount();
    if (state.mode === 'img2img') {
      els.imageInput.value = '';
      els.fileName.textContent = '最多选择 4 张图片作为再创作基础';
    }
    await Promise.all([loadProfile(), loadHistory(true), loadPointLogs()]);
    toast('任务已提交，完成后可在历史查看');
  } catch (err) {
    toast(err.message || '提交失败');
  } finally {
    state.loading = false;
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = state.mode === 'img2img' ? '上传并生成' : '开始生成';
  }
}

function submitTextGenerate(payload) {
  return api('/api/images/generate', { method: 'POST', body: payload });
}

function submitImageEdit(payload) {
  const form = new FormData();
  Array.from(els.imageInput.files || []).slice(0, 4).forEach(file => form.append('image', file));
  form.append('prompt', payload.prompt);
  form.append('model', payload.model);
  form.append('size', payload.size);
  return api('/api/images/edit', { method: 'POST', body: form });
}

async function loadHistory(reset) {
  if (!isLoggedIn()) return;
  if (reset) {
    state.historyPage = 1;
    state.historyList = [];
  }

  const data = await api(`/api/images/history?page=${state.historyPage}&pageSize=20`);
  state.historyTotal = data.total;
  state.historyList = reset ? data.list : state.historyList.concat(data.list);
  renderHistory();
  els.loadMoreBtn.classList.toggle('hidden', state.historyList.length >= state.historyTotal);
  state.historyPage += 1;
}

function renderHistory() {
  if (state.historyList.length === 0) {
    els.historyGrid.innerHTML = '<div class="task-box">暂无创作记录。</div>';
    return;
  }

  els.historyGrid.innerHTML = state.historyList.map(item => {
    const imageUrl = resolveImageUrl(item.result_image_path);
    const thumbnailUrl = resolveImageUrl(item.thumbnail_image_path || item.result_image_path);
    const statusClass = item.status === 'pending' ? 'pending' : (item.status === 'failed' ? 'failed' : '');
    const status = statusText(item.status);
    const typeText = item.type === 'img2img' ? '图生图' : '文生图';
    return `
      <article class="history-card" data-id="${item.id}">
        <div class="thumb">
          ${thumbnailUrl ? `<img src="${escapeHtml(thumbnailUrl)}" alt="生成图">` : `<span>${status}</span>`}
        </div>
        <div class="history-meta">
          <span class="badge ${statusClass}">${status}</span>
          <span>${typeText}</span>
          <span>${formatDateTime(item.created_at)}</span>
        </div>
        <h3>${escapeHtml(compactPrompt(item.prompt))}</h3>
        ${item.error_message ? `<p class="history-error">${escapeHtml(compactPrompt(item.error_message))}</p>` : ''}
      </article>
    `;
  }).join('');

  document.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

async function openDetail(id) {
  const item = await api(`/api/images/${id}`);
  const imageUrl = resolveImageUrl(item.result_image_path);
  els.detailBody.innerHTML = `
    <div class="detail-layout">
      <div class="detail-image">
        ${imageUrl ? `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(imageUrl)}" alt="生成图"></a>` : `<div class="thumb">${statusText(item.status)}</div>`}
      </div>
      <aside class="detail-side">
        <div class="detail-meta">
          <span class="badge ${item.status === 'pending' ? 'pending' : (item.status === 'failed' ? 'failed' : '')}">${statusText(item.status)}</span>
          <span>${item.type === 'img2img' ? '图生图' : '文生图'}</span>
          <span>${formatDateTime(item.created_at)}</span>
        </div>
        <h2>任务 #${item.id}</h2>
        <p class="detail-prompt">${escapeHtml(item.prompt || '')}</p>
        <p class="detail-prompt">模型：${escapeHtml(item.model || '-')}<br>画幅：${escapeHtml(item.size || '-')}<br>积分：${item.points_cost || 0}</p>
        ${item.error_message ? `<p class="detail-prompt">失败原因：${escapeHtml(item.error_message)}</p>` : ''}
        <button class="solid-btn" data-remix="${item.id}" ${imageUrl ? '' : 'disabled'}>基于此图再创作</button>
        ${imageUrl ? `<a class="ghost-btn" href="${escapeHtml(imageUrl)}" download>下载图片</a>` : ''}
      </aside>
    </div>
  `;
  els.detailModal.classList.remove('hidden');
  const remixBtn = els.detailBody.querySelector('[data-remix]');
  if (remixBtn && imageUrl) remixBtn.addEventListener('click', () => remixFrom(item, imageUrl));
}

function closeDetail() {
  els.detailModal.classList.add('hidden');
}

async function remixFrom(item, imageUrl) {
  closeDetail();
  switchView('create');
  setMode('img2img');
  els.promptInput.value = item.prompt ? `${item.prompt}\n\n请在保留主体氛围的基础上，进一步优化细节与构图。` : '';
  els.sizeSelect.value = item.size || '1024x1024';
  updateSelectedCost();
  els.taskTitle.textContent = '已带入上一张图的描述';
  els.taskDesc.textContent = 'PC 浏览器不能自动反填远程图片文件，请下载图片后重新选择参考图。';
  els.taskBox.classList.remove('hidden');
  els.taskBox.innerHTML = `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer">打开上一张图</a>，下载后上传作为参考图。`;
}

async function onCheckin() {
  if (!isLoggedIn()) {
    toast('请先微信扫码登录');
    return;
  }
  try {
    const result = await api('/api/user/checkin', { method: 'POST' });
    toast(`签到成功，获得 ${result.points} 积分`);
    await Promise.all([loadProfile(), loadPointLogs()]);
  } catch (err) {
    toast(err.message || '签到失败');
  }
}

function onLogout() {
  stopPolling();
  logoutWeb();
  renderAuthState();
  createWebLoginSession();
  switchView('create');
  toast('已退出登录');
}

async function onRedeemCdk(event) {
  event.preventDefault();
  if (!isLoggedIn()) {
    toast('请先微信扫码登录');
    return;
  }
  const code = els.cdkInput.value.trim();
  if (!code) {
    toast('请输入兑换码');
    return;
  }
  try {
    const result = await api('/api/user/cdk/redeem', { method: 'POST', body: { code } });
    toast(`兑换成功，获得 ${result.points} 积分`);
    els.cdkInput.value = '';
    await Promise.all([loadProfile(), loadPointLogs()]);
  } catch (err) {
    toast(err.message || '兑换失败');
  }
}

async function loadPointLogs() {
  if (!isLoggedIn()) return;
  const data = await api('/api/user/points?page=1&pageSize=12');
  if (!data.list.length) {
    els.pointsList.innerHTML = '<div class="points-row"><span>暂无积分记录</span></div>';
    return;
  }
  els.pointsList.innerHTML = data.list.map(item => `
    <div class="points-row">
      <div>
        <strong>${escapeHtml(pointType(item.type))}</strong>
        <span>${escapeHtml(item.remark || '')} · ${formatDateTime(item.created_at)}</span>
      </div>
      <strong class="${item.amount > 0 ? 'positive' : 'negative'}">${item.amount > 0 ? '+' : ''}${item.amount}</strong>
    </div>
  `).join('');
}

async function refreshAll(showToast = true) {
  if (!isLoggedIn()) {
    toast('请先微信扫码登录');
    return;
  }
  await Promise.all([loadProfile(), loadHistory(true), loadPointLogs()]);
  if (showToast) toast('状态已刷新');
}

function resolveImageUrl(path) {
  if (!path) return '';
  const first = String(path).split(',')[0].trim();
  if (/^https?:\/\//i.test(first)) return first;
  if (first.startsWith('/')) return first;
  return `/uploads/${first}`;
}

function statusText(status) {
  if (status === 'pending') return '生成中';
  if (status === 'failed') return '失败';
  return '已完成';
}

function pointType(type) {
  const map = {
    consume: '消费',
    recharge: '充值',
    cdk: '兑换',
    checkin: '签到',
    refund: '返还',
    invite: '邀请',
  };
  return map[type] || '积分';
}

function compactPrompt(prompt) {
  const text = prompt || '未填写描述';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

let toastTimer = null;
function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}
