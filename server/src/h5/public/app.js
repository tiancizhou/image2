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
  size: '1024x1024',
  community: {
    title: '加入梦倩绘境交流群',
    desc: '添加作者微信，进群领取积分福利，交流提示词和画面审美参考。',
    buttonText: '查看名片码',
    imageUrl: '/static/author-wechat-card.jpg',
  },
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
  sizeGrid: document.getElementById('sizeGrid'),
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
  inviteBtn: document.getElementById('inviteBtn'),
  communityBtn: document.getElementById('communityBtn'),
  communityMenuText: document.getElementById('communityMenuText'),
  communityMenuSub: document.getElementById('communityMenuSub'),
  communityBadgeText: document.getElementById('communityBadgeText'),
  communityModal: document.getElementById('communityModal'),
  communityTitle: document.getElementById('communityTitle'),
  communityDesc: document.getElementById('communityDesc'),
  communityImage: document.getElementById('communityImage'),
  communityLoading: document.getElementById('communityLoading'),
  communityPreviewBtn: document.getElementById('communityPreviewBtn'),
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
  await Promise.all([loadPublicConfig(), loadPricing()]);
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
  els.tabs.forEach(btn => on(btn, 'click', () => switchView(btn.dataset.view)));
  els.modeBtns.forEach(btn => on(btn, 'click', () => setMode(btn.dataset.mode)));
  on(els.promptInput, 'input', renderPromptCount);
  on(els.imageInput, 'change', renderSelectedFiles);
  on(els.sizeSelect, 'change', () => selectSize(els.sizeSelect.value));
  on(els.createForm, 'submit', submitCreate);
  on(els.newQrBtn, 'click', createWebLoginSession);
  on(els.closeTaskBtn, 'click', () => els.taskPanel?.classList.add('hidden'));
  on(els.goHistoryBtn, 'click', () => switchView('history'));
  on(els.loadMoreBtn, 'click', () => loadHistory(false));
  on(els.checkinBtn, 'click', checkin);
  on(els.cdkForm, 'submit', redeemCdk);
  on(els.logoutBtn, 'click', logout);
  on(els.pointsToggleBtn, 'click', togglePointLogs);
  on(els.inviteBtn, 'click', shareInvite);
  on(els.communityBtn, 'click', openCommunity);
  on(els.communityImage, 'load', () => els.communityLoading?.classList.add('hidden'));
  on(els.communityImage, 'error', () => {
    if (!els.communityLoading) return;
    els.communityLoading.textContent = '名片码加载失败';
    els.communityLoading.classList.remove('hidden');
  });
  on(els.communityPreviewBtn, 'click', previewCommunityCard);
  document.querySelectorAll('[data-close="detail"]').forEach(el => on(el, 'click', closeDetail));
  document.querySelectorAll('[data-close="community"]').forEach(el => on(el, 'click', closeCommunity));
}

function on(el, event, handler) {
  if (el) el.addEventListener(event, handler);
}

async function loadPublicConfig() {
  try {
    const data = await api('/api/user/public-config', { auth: false });
    const community = data.community || {};
    state.community = {
      title: community.title || state.community.title,
      desc: community.desc || state.community.desc,
      buttonText: community.buttonText || state.community.buttonText,
      imageUrl: resolveAssetUrl(community.imageUrl || state.community.imageUrl, community.imageVersion),
    };
  } catch {}
  renderCommunityConfig();
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
  const sizes = [
    { value: '1024x1024', label: '正方形', desc: '1024×1024', rect: 'width:20px;height:20px;' },
    { value: '1536x1024', label: '横版', desc: '1536×1024', rect: 'width:28px;height:18px;' },
    { value: '1024x1536', label: '竖版', desc: '1024×1536', rect: 'width:18px;height:28px;' },
    { value: '2048x2048', label: '2K 正方', desc: '2048×2048', rect: 'width:22px;height:22px;' },
    { value: '3840x2160', label: '4K 横版', desc: '3840×2160', rect: 'width:30px;height:17px;' },
  ];
  if (!els.sizeGrid) {
    if (els.sizeSelect) {
      els.sizeSelect.innerHTML = sizes.map((item) => {
        const selected = item.value === state.size ? ' selected' : '';
        return `<option value="${item.value}"${selected}>${item.label} ${item.desc} · ${costFor(item.value)} 积分</option>`;
      }).join('');
    }
    return;
  }
  els.sizeGrid.innerHTML = sizes.map((item) => {
    const active = item.value === state.size ? ' size-active' : '';
    const costText = `${costFor(item.value)} 积分`;
    return `
      <button class="size-card${active}" data-size="${item.value}" type="button">
        <span class="size-icon"><span class="size-rect" style="${item.rect}"></span></span>
        <span class="size-label">${item.label}</span>
        <span class="size-desc">${item.desc}</span>
        <span class="size-cost">${costText}</span>
      </button>`;
  }).join('');
  els.sizeGrid.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => selectSize(btn.dataset.size));
  });
}

function selectSize(size) {
  state.size = size || '1024x1024';
  renderSizeOptions();
  renderCost();
}

function costFor(size) {
  return state.pricing[size] !== undefined ? state.pricing[size] : 1;
}

function renderCost() {
  const cost = costFor(state.size);
  if (els.currentCost) els.currentCost.textContent = cost;
  if (els.costInline) els.costInline.textContent = cost;
}

function renderPromptCount() {
  if (els.promptCount && els.promptInput) {
    els.promptCount.textContent = `${els.promptInput.value.length}/2000`;
  }
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
  Object.entries(els.views).forEach(([key, el]) => el?.classList.toggle('hidden', key !== view));
  renderAuthState();
  if (!isLoggedIn()) return;
  if (view === 'history') loadHistory(true);
  if (view === 'profile') {
    loadProfile();
  }
}

async function createWebLoginSession() {
  stopPolling();
  els.qrImage?.removeAttribute('src');
  if (els.qrStatus) els.qrStatus.textContent = '正在生成小程序码...';
  try {
    const data = await api('/api/auth/web-login/session', {
      method: 'POST',
      auth: false,
      body: { invite_code: getIncomingInviteCode() },
    });
    state.webLoginToken = data.token;
    if (els.qrImage) els.qrImage.src = data.qr_image;
    if (els.qrStatus) els.qrStatus.textContent = '请用微信扫码打开小程序确认登录';
    startPolling();
  } catch (err) {
    const message = err.message || '小程序码生成失败';
    if (els.qrStatus) els.qrStatus.textContent = message;
    toast(message);
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
    if (els.qrStatus) els.qrStatus.textContent = err.message || '登录状态查询失败';
    return;
  }
  if (data.status === 'pending') {
    if (els.qrStatus) els.qrStatus.textContent = '等待微信扫码确认...';
    return;
  }
  if (data.status === 'expired') {
    stopPolling();
    if (els.qrStatus) els.qrStatus.textContent = '小程序码已过期，请刷新';
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
  els.authPanel?.classList.toggle('hidden', loggedIn || state.view !== 'create');
  els.modeSwitch?.classList.toggle('hidden', !loggedIn || state.view !== 'create');
  els.createForm?.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    if (els.userPoints) els.userPoints.textContent = '--';
    if (els.pointsInline) els.pointsInline.textContent = '--';
    if (els.accountPoints) els.accountPoints.textContent = '--';
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
  if (els.userPoints) els.userPoints.textContent = user.points ?? 0;
  if (els.pointsInline) els.pointsInline.textContent = user.points ?? 0;
  if (els.accountPoints) els.accountPoints.textContent = user.points ?? 0;
  if (els.userName) els.userName.textContent = displayName;
  if (els.userCode) els.userCode.textContent = `UID ${user.id}`;
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
  if ((state.user?.points ?? 0) < costFor(state.size)) {
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
      size: state.size,
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
  state.size = item.size || '1024x1024';
  renderSizeOptions();
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
  if (!els.pointsPanel) return;
  if (!els.pointsPanel.classList.contains('hidden')) {
    els.pointsPanel.classList.add('hidden');
    return;
  }
  await loadPointLogs();
}

function renderCommunityConfig() {
  const community = state.community;
  if (els.communityMenuText) els.communityMenuText.textContent = community.title;
  if (els.communityMenuSub) els.communityMenuSub.textContent = community.desc;
  if (els.communityBadgeText) els.communityBadgeText.textContent = community.buttonText;
  if (els.communityTitle) els.communityTitle.textContent = community.title;
  if (els.communityDesc) els.communityDesc.textContent = community.desc;
  if (els.communityPreviewBtn) els.communityPreviewBtn.textContent = community.buttonText;
  if (community.imageUrl) {
    if (els.communityLoading) {
      els.communityLoading.textContent = '名片码加载中...';
      els.communityLoading.classList.remove('hidden');
    }
    if (els.communityImage) {
      els.communityImage.src = community.imageUrl;
      if (els.communityImage.complete && els.communityImage.naturalWidth > 0) {
        els.communityLoading?.classList.add('hidden');
      }
    }
  }
}

async function shareInvite() {
  if (!isLoggedIn()) {
    toast('请先扫码登录');
    return;
  }
  const inviteUrl = buildInviteUrl();
  const shareData = {
    title: '梦倩绘境积分福利入口',
    text: '来梦倩绘境一起整理画面灵感，首次进入后可同步积分福利。',
    url: inviteUrl,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await copyText(inviteUrl);
    toast('邀请链接已复制');
  } catch (err) {
    if (err.name === 'AbortError') return;
    toast(err.message || '分享失败');
  }
}

function buildInviteUrl() {
  const inviteCode = state.user?.invite_code || state.user?.id || '';
  const url = new URL('/h5', window.location.origin);
  if (inviteCode) url.searchParams.set('inviter', inviteCode);
  return url.toString();
}

function getIncomingInviteCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('inviter') || params.get('invite_code') || '';
}

function openCommunity() {
  renderCommunityConfig();
  if (!els.communityModal) {
    previewCommunityCard();
    return;
  }
  els.communityModal.classList.remove('hidden');
}

function closeCommunity() {
  els.communityModal?.classList.add('hidden');
}

function previewCommunityCard() {
  const imageUrl = state.community.imageUrl;
  if (!imageUrl) {
    toast('暂无名片码');
    return;
  }
  window.open(imageUrl, '_blank', 'noopener,noreferrer');
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

function resolveAssetUrl(path, version = '') {
  if (!path) return '';
  let url = path;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) {
    url = `/${url}`;
  }
  if (version && !url.includes('/static/')) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}v=${encodeURIComponent(version)}`;
  }
  return url;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-999px';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
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
  if (!els.toast) return;
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}
