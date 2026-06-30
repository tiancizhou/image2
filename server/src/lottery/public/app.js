const state = {
  token: localStorage.getItem('mq_lottery_token') || '',
  user: null,
  webLoginToken: '',
  pollTimer: null,
  me: null,
  busy: false,
};

const els = {
  loginPanel: document.getElementById('loginPanel'),
  dashboard: document.getElementById('dashboard'),
  qrImage: document.getElementById('qrImage'),
  qrStatus: document.getElementById('qrStatus'),
  newQrBtn: document.getElementById('newQrBtn'),
  claimBtn: document.getElementById('claimBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  drawBtn: document.getElementById('drawBtn'),
  drawHint: document.getElementById('drawHint'),
  chanceCount: document.getElementById('chanceCount'),
  pointsText: document.getElementById('pointsText'),
  checkinText: document.getElementById('checkinText'),
  inviteText: document.getElementById('inviteText'),
  rulesList: document.getElementById('rulesList'),
  prizeGrid: document.getElementById('prizeGrid'),
  historyList: document.getElementById('historyList'),
  toast: document.getElementById('toast'),
  resultModal: document.getElementById('resultModal'),
  resultTitle: document.getElementById('resultTitle'),
  resultDesc: document.getElementById('resultDesc'),
};

init().catch(err => {
  console.error(err);
  toast(err.message || '初始化失败');
});

async function init() {
  bindEvents();
  if (state.token) {
    try {
      await loadMe();
      renderAuth(true);
      return;
    } catch {
      logout();
    }
  }
  renderAuth(false);
  await createWebLoginSession();
}

function bindEvents() {
  els.newQrBtn.addEventListener('click', createWebLoginSession);
  els.refreshBtn.addEventListener('click', () => loadMe(true));
  els.claimBtn.addEventListener('click', claimRules);
  els.drawBtn.addEventListener('click', draw);
  document.querySelectorAll('[data-close="result"]').forEach(el => {
    el.addEventListener('click', () => els.resultModal.classList.add('hidden'));
  });
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
    els.qrStatus.textContent = '小程序码已过期，请重新生成';
    return;
  }
  if (data.status === 'confirmed') {
    stopPolling();
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mq_lottery_token', state.token);
    await loadMe();
    renderAuth(true);
    toast('登录成功，抽奖账户已连接');
  }
}

async function loadMe(showToast = false) {
  state.me = await api('/api/lottery/me');
  renderMe();
  if (showToast) toast('状态已刷新');
}

async function claimRules() {
  if (!ensureLogin() || state.busy) return;
  state.busy = true;
  els.claimBtn.disabled = true;
  try {
    const data = await api('/api/lottery/claim-rules', { method: 'POST' });
    state.me = data.me;
    renderMe();
    const amount = data.granted.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    toast(amount > 0 ? `已领取 ${amount} 次抽奖机会` : '暂无新的可领取机会');
  } catch (err) {
    toast(err.message || '领取失败');
  } finally {
    state.busy = false;
    els.claimBtn.disabled = false;
  }
}

async function draw() {
  if (!ensureLogin() || state.busy) return;
  if (!state.me?.chances?.remaining) {
    toast('暂无抽奖次数，请先领取机会');
    return;
  }

  state.busy = true;
  els.drawBtn.disabled = true;
  els.drawHint.textContent = '正在揭晓结果...';
  try {
    const data = await api('/api/lottery/draw', { method: 'POST' });
    state.me = data.me;
    renderMe();
    showResult(data.draw);
  } catch (err) {
    toast(err.message || '抽奖失败');
  } finally {
    state.busy = false;
    els.drawBtn.disabled = false;
  }
}

function renderAuth(loggedIn) {
  els.loginPanel.classList.toggle('hidden', loggedIn);
  els.dashboard.classList.toggle('hidden', !loggedIn);
  els.claimBtn.disabled = !loggedIn;
  els.drawBtn.disabled = !loggedIn;
  if (!loggedIn) {
    els.chanceCount.textContent = '--';
    els.drawHint.textContent = '登录后查看你的抽奖机会';
  }
}

function renderMe() {
  const me = state.me;
  if (!me?.active) {
    els.dashboard.classList.add('hidden');
    els.chanceCount.textContent = '0';
    els.drawHint.textContent = '活动暂未开放';
    toast('当前没有可参与的抽奖活动');
    return;
  }

  renderAuth(true);
  els.chanceCount.textContent = me.chances.remaining;
  els.drawHint.textContent = me.chances.remaining > 0
    ? '点击立即抽奖，奖品会自动发放'
    : '完成任务后先领取机会';
  els.pointsText.textContent = me.stats.points;
  els.checkinText.textContent = me.stats.consecutiveCheckins;
  els.inviteText.textContent = me.stats.inviteCount;
  els.rulesList.innerHTML = renderRules(me.rules);
  els.prizeGrid.innerHTML = renderPrizes(me.prizes);
  els.historyList.innerHTML = renderHistory(me.history);
}

function renderRules(rules) {
  if (!rules?.length) return '<div class="history-row"><span>暂无任务规则</span></div>';
  return rules.map(rule => {
    const pillClass = rule.claimed ? 'done' : (rule.claimable ? 'ready' : '');
    const pillText = rule.claimed ? '已领取' : (rule.claimable ? `可领 ${rule.amount} 次` : `${rule.progress}/${rule.target}`);
    return `
      <article class="rule-card">
        <div>
          <h3>${escapeHtml(rule.title)}</h3>
          <p>${escapeHtml(rule.description)}</p>
        </div>
        <strong class="rule-pill ${pillClass}">${escapeHtml(pillText)}</strong>
      </article>
    `;
  }).join('');
}

function renderPrizes(prizes) {
  if (!prizes?.length) return '<div class="history-row"><span>暂无奖品</span></div>';
  return prizes.map(prize => `
    <article class="prize-card">
      <span>${prize.type === 'points' ? '积分奖品' : '特别奖项'}</span>
      <strong>${escapeHtml(prize.name)}</strong>
    </article>
  `).join('');
}

function renderHistory(history) {
  if (!history?.length) return '<div class="history-row"><span>暂无中奖记录</span><strong>去抽一次</strong></div>';
  return history.map(item => `
    <div class="history-row">
      <div>
        <strong>${escapeHtml(item.prize_name)}</strong>
        <span>${formatDateTime(item.created_at)}</span>
      </div>
      <strong>${item.points > 0 ? `+${item.points} 积分` : '谢谢参与'}</strong>
    </div>
  `).join('');
}

function showResult(drawResult) {
  const points = Number(drawResult.points || 0);
  els.resultTitle.textContent = points > 0 ? `抽中 ${drawResult.prize_name}` : drawResult.prize_name;
  els.resultDesc.textContent = points > 0
    ? `${points} 积分已自动发放到你的账户。`
    : '这次没有抽中积分，继续签到或邀请好友获取更多机会。';
  els.resultModal.classList.remove('hidden');
}

function ensureLogin() {
  if (state.token) return true;
  toast('请先微信扫码登录');
  return false;
}

function logout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('mq_lottery_token');
}

async function api(url, options = {}) {
  const headers = options.headers || {};
  if (options.auth !== false) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await parseJson(res);
  if (res.status === 401 && options.auth !== false) {
    logout();
    renderAuth(false);
    await createWebLoginSession();
    throw new Error('登录已过期，请重新扫码');
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
