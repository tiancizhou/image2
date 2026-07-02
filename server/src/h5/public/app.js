const state = {
  token: localStorage.getItem('mq_h5_token') || localStorage.getItem('mq_pc_token') || '',
  user: null,
  webLoginToken: '',
  pollTimer: null,
  mode: 'text2img',
  view: 'create',
  page: 1,
  total: 0,
  history: [],
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
  authPanel: document.getElementById('authPanel'),
  qrImage: document.getElementById('qrImage'),
  qrStatus: document.getElementById('qrStatus'),
  newQrBtn: document.getElementById('newQrBtn'),
  createForm: document.getElementById('createForm'),
  modeBtns: document.querySelectorAll('.mode-item'),
  modeSwitch: document.getElementById('modeSwitch'),
  uploadPanel: document.getElementById('uploadPanel'),
  uploadPlaceholder: document.getElementById('uploadPlaceholder'),
  imageInput: document.getElementById('imageInput'),
  fileName: document.getElementById('fileName'),
  fileCount: document.getElementById('fileCount'),
  promptLabel: document.getElementById('promptLabel'),
  promptInput: document.getElementById('promptInput'),
  promptCount: document.getElementById('promptCount'),
  sizeSelect: document.getElementById('sizeSelect'),
  currentCost: document.getElementById('currentCost'),
  costInline: document.getElementById('costInline'),
  pointsInline: document.getElementById('pointsInline'),
  submitBtn: document.getElementById('submitBtn'),
  taskPanel: document.getElementById('taskPanel'),
  taskText: document.getElementById('taskText'),
  closeTaskBtn: document.getElementById('closeTaskBtn'),
  goHistoryBtn: document.getElementById('goHistoryBtn'),
  tabs: document.querySelectorAll('.tab'),
  views: {
    create: document.getElementById('createView'),
    history: document.getElementById('historyView'),
    profile: document.getElementById('profileView'),
  },
  userPoints: document.getElementById('userPoints'),
  pointsInlineValue: document.getElementById('pointsInline'),
  accountPoints: document.getElementById('accountPoints'),
  userName: document.getElementById('userName'),
  userCode: document.getElementById('userCode'),
  historyList: document.getElementById('historyList'),
  emptyHistory: document.getElementById('emptyHistory'),
  pollingTip: document.getElementById('pollingTip'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  checkinBtn: document.getElementById('checkinBtn'),
  cdkForm: document.getElementById('cdkForm'),
  cdkInput: document.getElementById('cdkInput'),
  logoutBtn: document.getElementById('logoutBtn'),
  pointsList: document.getElementById('pointsList'),
  pointsToggleBtn: document.getElementById('pointsToggleBtn'),
  pointsPanel: document.getElementById('pointsPanel'),
  detailSheet: document.getElementById('detailSheet'),
  detailBody: document.getElementById('detailBody'),
  toast: document.getElementById('toast'),
};

init().catch((err) => {
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
      logoutLocal();
    }
  }
  renderAuthState();
  if (isLoggedIn()) {
    await loadHistory(true);
  } else {
    await createWebLoginSession();
  }
}

function bindEvents() {
  els.tabs.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  els.modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  els.promptInput.addEventListener('input', renderPromptCount);
  els.sizeSelect.addEventListener('change', renderCost);
  els.imageInput.addEventListener('change', renderSelectedFiles);
  els.createForm.addEventListener('submit', submitCreate);
  els.newQrBtn.addEventListener('click', createWebLoginSession);
  els.closeTaskBtn.addEventListener('click', () => els.taskPanel.classList.add('hidden'));
  els.goHistoryBtn.addEventListener('click', () => switchView('history'));
  els.loadMoreBtn.addEventListener('click', () => loadHistory(false));
  els.checkinBtn.addEventListener('click', checkin);
  els.cdkForm.addEventListener('submit', redeemCdk);
  els.logoutBtn.addEventListener('click', logout);
  els.pointsToggleBtn.addEventListener('click', togglePointLogs);
  document.querySelectorAll('[data-close="detail"]').forEach(el => el.addEventListener('click', closeDetail));
}

async function loadPricing() {
  try {
    const pricing = await api('/api/images/pricing', { auth: false });
    Object.entries(pricing.sizes || {}).forEach(([size, config]) => {
      state.pricing[size] = config.points_cost;
    });
  } catch {}
  renderSizeOptions();
  renderCost();
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
    return `<option value="${size}"${selected}>${labels[size]} · ${costFor(size)} 积分</option>`;
  }).join('');
}

function costFor(size) {
  return state.pricing[size] !== undefined ? state.pricing[size] : 1;
}

function renderCost() {
  const cost = costFor(els.sizeSelect.value);
  els.currentCost.textContent = cost;
  els.costInline.textContent = cost;
}

function renderPromptCount() {
  els.promptCount.textContent = `${els.promptInput.value.length}/2000`;
}

function renderSelectedFiles() {
  const files = Array.from(els.imageInput.files || []).slice(0, 4);
  els.fileCount.textContent = files.length ? `${files.length}/4 张` : '最多 4 张';
  els.uploadPanel.querySelector('.upload-area').classList.toggle('has-image', files.length > 0);
  if (!files.length) {
    els.uploadPlaceholder.innerHTML = `
      <span class="upload-icon">+</span>
      <span class="upload-text">上传参考图</span>
      <span id="fileName" class="upload-hint">最多 4 张，支持相册或拍照</span>`;
    return;
  }
  const previews = files.map(file => `<img class="preview-tile" src="${escapeHtml(URL.createObjectURL(file))}" alt="参考图">`).join('');
  els.uploadPlaceholder.innerHTML = `
    <div class="preview-grid">
      ${previews}
      <div class="preview-count">${files.length}/4 张 · 点击继续添加</div>
    </div>`;
}

function setMode(mode) {
  state.mode = mode;
  els.modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  els.uploadPanel.classList.toggle('hidden', mode !== 'img2img');
  els.promptLabel.textContent = mode === 'img2img' ? '编辑描述' : '画面描述';
  els.promptInput.placeholder = mode === 'img2img'
    ? '例如：保留主体，把背景改成雨夜霓虹街道。'
    : '例如：一只漂浮在太空里的猫，电影感打光，超细节...';
  els.submitBtn.textContent = mode === 'img2img' ? '根据图片生成' : '开始生成';
  els.submitBtn.classList.toggle('edit', mode === 'img2img');
}

function switchView(view) {
  if (!isLoggedIn() && view !== 'create') {
    toast('请先扫码登录');
    view = 'create';
  }
  state.view = view;
  els.tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  Object.entries(els.views).forEach(([key, el]) => el.classList.toggle('hidden', key !== view));
  renderAuthState();
  if (!isLoggedIn()) return;
  if (view === 'history') loadHistory(true);
  if (view === 'profile') {
    loadProfile();
  }
}

async function createWebLoginSession() {
  stopPolling();
  els.qrImage.removeAttribute('src');
  els.qrStatus.textContent = '正在生成小程序码...';
  try {
    const data = await api('/api/auth/web-login/session', { method: 'POST', auth: false });
    state.webLoginToken = data.token;
    els.qrImage.src = data.qr_image;
    els.qrStatus.textContent = '请用微信扫码打开小程序确认登录';
    startPolling();
  } catch (err) {
    els.qrStatus.textContent = err.message || '小程序码生成失败';
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
    return;
  }
  if (data.status === 'expired') {
    stopPolling();
    els.qrStatus.textContent = '小程序码已过期，请刷新';
    return;
  }
  if (data.status === 'confirmed') {
    stopPolling();
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mq_h5_token', state.token);
    localStorage.setItem('mq_pc_token', state.token);
    renderAuthState();
    await Promise.all([loadProfile(), loadHistory(true)]);
    toast('登录成功');
  }
}

function isLoggedIn() {
  return Boolean(state.token && state.user);
}

function renderAuthState() {
  const loggedIn = isLoggedIn();
  els.authPanel.classList.toggle('hidden', loggedIn || state.view !== 'create');
  els.modeSwitch.classList.toggle('hidden', !loggedIn || state.view !== 'create');
  els.createForm.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    els.userPoints.textContent = '--';
    els.pointsInline.textContent = '--';
    els.accountPoints.textContent = '--';
    return;
  }
  renderUser();
}

async function loadProfile() {
  if (!state.token) return;
  const user = await api('/api/user/profile');
  state.user = user;
  renderUser();
}

function renderUser() {
  const user = state.user;
  if (!user) return;
  const displayName = user.nickname || `绘境用户 #${user.id}`;
  els.userPoints.textContent = user.points ?? 0;
  els.pointsInline.textContent = user.points ?? 0;
  els.accountPoints.textContent = user.points ?? 0;
  els.userName.textContent = displayName;
  els.userCode.textContent = `UID ${user.id}`;
}

async function submitCreate(event) {
  event.preventDefault();
  if (!isLoggedIn()) {
    toast('请先扫码登录');
    return;
  }
  if (state.loading) return;
  const prompt = els.promptInput.value.trim();
  if (!prompt) {
    toast('请输入画面描述');
    return;
  }
  if (state.mode === 'img2img' && !els.imageInput.files.length) {
    toast('请先上传参考图');
    return;
  }
  if ((state.user?.points ?? 0) < costFor(els.sizeSelect.value)) {
    toast('积分不足，请先签到或兑换');
    switchView('profile');
    return;
  }

  state.loading = true;
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = '提交中...';
  try {
    const payload = {
      prompt,
      model: 'gpt-image-2',
      size: els.sizeSelect.value,
    };
    const result = state.mode === 'img2img'
      ? await submitImageEdit(payload)
      : await api('/api/images/generate', { method: 'POST', body: payload });

    els.taskText.textContent = `任务 #${result.id} 已提交，冻结 ${result.points_cost} 积分。`;
    els.taskPanel.classList.remove('hidden');
    els.promptInput.value = '';
    renderPromptCount();
    if (state.mode === 'img2img') {
      els.imageInput.value = '';
      renderSelectedFiles();
    }
    await Promise.all([loadProfile(), loadHistory(true)]);
    toast('任务已进入队列');
  } catch (err) {
    toast(err.message || '提交失败');
  } finally {
    state.loading = false;
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = state.mode === 'img2img' ? '根据图片生成' : '开始生成';
  }
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
    state.page = 1;
    state.history = [];
  }
  const data = await api(`/api/images/history?page=${state.page}&pageSize=10`);
  state.total = data.total;
  state.history = reset ? data.list : state.history.concat(data.list);
  state.page += 1;
  renderHistory();
}

function renderHistory() {
  els.loadMoreBtn.classList.toggle('hidden', state.history.length >= state.total);
  els.emptyHistory.classList.toggle('hidden', state.history.length > 0);
  els.historyList.classList.toggle('hidden', state.history.length === 0);
  els.pollingTip.classList.toggle('hidden', !state.history.some(item => item.status === 'pending'));
  if (!state.history.length) {
    els.historyList.innerHTML = '';
    return;
  }
  els.historyList.innerHTML = state.history.map(item => {
    const imageUrl = resolveImageUrl(item.thumbnail_image_path || item.result_image_path);
    const statusClass = item.status === 'pending' ? 'pending' : (item.status === 'failed' ? 'failed' : '');
    const typeText = item.type === 'img2img' ? '图生图' : '文生图';
    return `
      <article class="history-card" data-id="${item.id}">
        ${imageUrl
          ? `<img class="history-thumb" src="${escapeHtml(imageUrl)}" alt="生成图">`
          : `<div class="history-thumb placeholder ${statusClass}">
              <span>${statusText(item.status)}</span>
              ${item.error_message ? `<span class="error-text">${escapeHtml(compact(item.error_message, 48))}</span>` : ''}
            </div>`}
        <div class="history-meta">
          <div class="meta-top">
            <span class="status-badge ${statusClass}">${statusText(item.status)}</span>
            <span class="history-type">${typeText}</span>
          </div>
          <span class="history-prompt">${escapeHtml(compact(item.prompt, 56))}</span>
          <span class="history-info">${escapeHtml(item.size || '-')} · ${formatDateTime(item.created_at)}</span>
          ${item.status === 'failed' ? `<button class="retry-btn" data-retry="${item.id}" type="button">重新生成</button>` : ''}
        </div>
      </article>`;
  }).join('');
  document.querySelectorAll('.history-card').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id));
  });
  document.querySelectorAll('[data-retry]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      retryGeneration(btn.dataset.retry);
    });
  });
}

async function openDetail(id) {
  try {
    const item = await api(`/api/images/${id}`);
    const imageUrl = resolveImageUrl(item.result_image_path);
    const typeText = item.type === 'img2img' ? '图生图' : '文生图';
    els.detailBody.innerHTML = `
      <section class="card image-card">
        <div class="image-tag">${typeText}</div>
        ${imageUrl
          ? `<img class="detail-image" src="${escapeHtml(imageUrl)}" alt="生成图">`
          : `<div class="history-thumb placeholder ${item.status === 'failed' ? 'failed' : 'pending'}">${statusText(item.status)}</div>`}
      </section>
      <section class="card info-card">
        <div class="prompt-block">
          <span class="block-label">提示词</span>
          <span class="prompt-text">${escapeHtml(item.prompt || '')}</span>
        </div>
        <div class="info-grid">
          <div class="info-pill"><span class="detail-label">尺寸</span><span class="detail-value">${escapeHtml(item.size || '-')}</span></div>
          <div class="info-pill"><span class="detail-label">类型</span><span class="detail-value">${typeText}</span></div>
          <div class="info-pill"><span class="detail-label">积分</span><span class="detail-value">${item.points_cost || 0}</span></div>
          <div class="info-pill"><span class="detail-label">状态</span><span class="detail-value">${statusText(item.status)}</span></div>
        </div>
        <div class="time-row"><span>生成时间</span><span>${formatDateTime(item.created_at)}</span></div>
        ${item.error_message ? `<div class="prompt-block error-block"><span class="block-label">失败原因</span><span class="prompt-text">${escapeHtml(item.error_message)}</span></div>` : ''}
      </section>
      <section class="card action-card">
        <button class="action-btn action-primary" type="button" data-remix="${item.id}" ${imageUrl ? '' : 'disabled'}>
          <span>基于此图再创作</span>
          <span class="action-sub">带入图生图继续调整</span>
        </button>
        <div class="action-row">
          ${imageUrl ? `<a class="action-btn action-secondary" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer">查看原图</a>` : '<span></span>'}
          ${item.status === 'failed' ? `<button class="action-btn action-danger" type="button" data-retry="${item.id}">重新生成</button>` : '<span></span>'}
        </div>
      </section>`;
    els.detailSheet.classList.remove('hidden');
    const retryBtn = els.detailBody.querySelector('[data-retry]');
    if (retryBtn) retryBtn.addEventListener('click', () => retryGeneration(item.id));
    const remixBtn = els.detailBody.querySelector('[data-remix]');
    if (remixBtn && imageUrl) remixBtn.addEventListener('click', () => remixFromDetail(item));
  } catch (err) {
    toast(err.message || '加载详情失败');
  }
}

function closeDetail() {
  els.detailSheet.classList.add('hidden');
}

function remixFromDetail(item) {
  closeDetail();
  switchView('create');
  setMode('img2img');
  els.promptInput.value = item.prompt ? `${item.prompt}\n\n请在保留主体氛围的基础上，进一步优化细节与构图。` : '';
  els.sizeSelect.value = item.size || '1024x1024';
  renderPromptCount();
  renderCost();
  toast('已带入描述，请上传原图或参考图');
}

async function retryGeneration(id) {
  try {
    const result = await api(`/api/images/${id}/retry`, { method: 'POST' });
    closeDetail();
    toast(`已重新提交任务 #${result.id}`);
    await Promise.all([loadProfile(), loadHistory(true)]);
  } catch (err) {
    toast(err.message || '重试失败');
  }
}

async function checkin() {
  if (!isLoggedIn()) {
    toast('请先扫码登录');
    return;
  }
  try {
    const result = await api('/api/user/checkin', { method: 'POST' });
    toast(`签到成功，获得 ${result.points} 积分`);
    await loadProfile();
    if (!els.pointsPanel.classList.contains('hidden')) await loadPointLogs();
  } catch (err) {
    toast(err.message || '签到失败');
  }
}

async function redeemCdk(event) {
  event.preventDefault();
  const code = els.cdkInput.value.trim();
  if (!code) {
    toast('请输入兑换码');
    return;
  }
  try {
    const result = await api('/api/user/cdk/redeem', { method: 'POST', body: { code } });
    els.cdkInput.value = '';
    toast(`兑换成功，获得 ${result.points} 积分`);
    await loadProfile();
    if (!els.pointsPanel.classList.contains('hidden')) await loadPointLogs();
  } catch (err) {
    toast(err.message || '兑换失败');
  }
}

async function loadPointLogs() {
  if (!isLoggedIn()) return;
  els.pointsPanel.classList.remove('hidden');
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

async function togglePointLogs() {
  if (!isLoggedIn()) return;
  if (!els.pointsPanel.classList.contains('hidden')) {
    els.pointsPanel.classList.add('hidden');
    return;
  }
  await loadPointLogs();
}

function logout() {
  stopPolling();
  logoutLocal();
  renderAuthState();
  switchView('create');
  createWebLoginSession();
  toast('已退出登录');
}

function logoutLocal() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('mq_h5_token');
  localStorage.removeItem('mq_pc_token');
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
    logoutLocal();
    renderAuthState();
    throw new Error('请先扫码登录');
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
    lottery: '抽奖',
    reward_ad: '广告奖励',
  };
  return map[type] || '积分';
}

function compact(value, max) {
  const text = String(value || '未填写描述').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
