const API = '/admin/api';
let token = localStorage.getItem('admin_token') || '';
let currentView = 'settings';
let cachedChannels = [];

function intValue(id, fallback) {
  const value = Number.parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(value) ? value : fallback;
}

async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${url}`, { ...options, headers });
  if (res.status === 401) {
    token = '';
    localStorage.removeItem('admin_token');
    render();
    return null;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function closeModal() {
  const modal = document.querySelector('.modal-backdrop');
  if (modal) modal.remove();
}

function navigate(view) {
  currentView = view;
  syncNavState();
  renderContent();
}

function syncNavState() {
  document.querySelectorAll('.sidebar a[data-view]').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === currentView);
  });
}

function render() {
  const app = document.getElementById('app');
  if (!token) {
    renderLogin(app);
    return;
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">IMG</span>
          <div>
            <strong>梦倩绘境</strong>
            <small>绘境服务控制台</small>
          </div>
        </div>
        <nav>
          <a href="#" data-view="settings" class="${currentView === 'settings' ? 'active' : ''}">渠道与系统</a>
          <a href="#" data-view="generations" class="${currentView === 'generations' ? 'active' : ''}">生成记录</a>
          <a href="#" data-view="users" class="${currentView === 'users' ? 'active' : ''}">用户管理</a>
          <a href="#" data-view="cdk" class="${currentView === 'cdk' ? 'active' : ''}">CDK 管理</a>
        </nav>
        <button class="ghost-link" id="logout">退出登录</button>
      </aside>
      <main class="main">
        <div class="ambient"></div>
        <section id="content" class="content-panel"></section>
      </main>
    </div>`;

  app.querySelectorAll('.sidebar a[data-view]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      navigate(a.dataset.view);
    };
  });
  document.getElementById('logout').onclick = () => {
    token = '';
    localStorage.removeItem('admin_token');
    render();
  };
  renderContent();
}

function renderLogin(app) {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-orb"></div>
      <form class="login-card" id="login-form">
        <p class="eyebrow">梦倩绘境 OPS</p>
        <h1>绘境控制塔</h1>
        <p class="muted">管理绘境渠道、积分策略与运营数据。</p>
        <label>用户名</label>
        <input id="login-user" type="text" autocomplete="username" autofocus>
        <label>密码</label>
        <input id="login-pass" type="password" autocomplete="current-password">
        <button class="btn btn-primary full" type="submit">进入后台</button>
      </form>
    </div>`;

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await request('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('login-user').value,
          password: document.getElementById('login-pass').value,
        }),
      });
      token = res.token;
      localStorage.setItem('admin_token', token);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderContent() {
  const el = document.getElementById('content');
  if (!el) return;
  el.innerHTML = `<div class="loading">正在同步控制台数据...</div>`;
  try {
    if (currentView === 'settings') await renderSettings(el);
    if (currentView === 'users') await renderUsers(el);
    if (currentView === 'generations') await renderGenerations(el);
    if (currentView === 'cdk') await renderCdk(el);
  } catch (err) {
    el.innerHTML = `<div class="error-box">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

function pageHeader(title, desc, action = '') {
  return `
    <div class="page-header">
      <div>
        <p class="eyebrow">CONTROL SURFACE</p>
        <h2>${title}</h2>
        <p>${desc}</p>
      </div>
      ${action}
    </div>`;
}

async function renderSettings(el) {
  const [settings, channelRes] = await Promise.all([
    request('/settings'),
    request('/channels'),
  ]);
  cachedChannels = channelRes.list || [];

  const openCount = cachedChannels.filter((c) => c.circuit_status === 'open').length;
  const enabledCount = cachedChannels.filter((c) => c.enabled).length;

  el.innerHTML = `
    ${pageHeader('渠道与系统', '配置多中转站、自动熔断参数和小程序积分策略。', '<button class="btn btn-primary" id="new-channel">新增渠道</button>')}
    <div class="metric-grid">
      <div class="metric-card"><span>可用渠道</span><strong>${enabledCount}</strong><small>按优先级自动切换</small></div>
      <div class="metric-card danger"><span>熔断中</span><strong>${openCount}</strong><small>冷却后自动恢复候选</small></div>
      <div class="metric-card"><span>默认模型</span><strong>${escapeHtml(settings.default_model || 'gpt-image-2')}</strong><small>用于小程序生成</small></div>
    </div>
    <div class="split-grid">
      <section class="card">
        <div class="card-header">
          <div>
            <h3>中转站渠道</h3>
            <p>优先级数字越小越先尝试；失败达到阈值后自动熔断。</p>
          </div>
        </div>
        <div class="channel-list" id="channel-list">${renderChannelCards(cachedChannels)}</div>
      </section>
      <section class="card">
        <div class="card-header">
          <div>
            <h3 id="channel-form-title">新增渠道</h3>
            <p>API Key 保存后不会在列表中明文展示。</p>
          </div>
        </div>
        ${renderChannelForm()}
      </section>
    </div>
    <section class="card">
      <div class="card-header">
        <div>
          <h3>系统策略</h3>
          <p>这些设置独立于中转站渠道。</p>
        </div>
      </div>
      <div class="settings-grid">
        <label>默认模型<input id="s-default_model" value="${escapeHtml(settings.default_model || 'gpt-image-2')}"></label>
        <label>每次生图消耗积分<input id="s-points_per_generation" type="number" min="0" value="${escapeHtml(settings.points_per_generation || 1)}"></label>
        <label>每日签到积分<input id="s-checkin_points" type="number" min="0" value="${escapeHtml(settings.checkin_points || 1)}"></label>
        <label>连续签到奖励 JSON<input id="s-checkin_consecutive_bonus" value="${escapeHtml(settings.checkin_consecutive_bonus || '{}')}"></label>
      </div>
      <button class="btn btn-secondary" id="save-settings">保存系统策略</button>
    </section>`;

  bindSettingsEvents();
}

function renderChannelCards(channels) {
  if (channels.length === 0) {
    return `<div class="empty">尚未配置渠道。新增至少一个启用渠道后，图片生成才会可用。</div>`;
  }
  return channels.map((c) => {
    const isOpen = c.circuit_status === 'open';
    const statusClass = isOpen ? 'open' : (c.enabled ? 'closed' : 'disabled');
    const statusText = isOpen ? '熔断中' : (c.enabled ? '健康候选' : '已停用');
    return `
      <article class="channel-card ${statusClass}">
        <div class="channel-top">
          <div>
            <span class="status-dot"></span>
            <strong>${escapeHtml(c.name)}</strong>
          </div>
          <span class="pill">${statusText}</span>
        </div>
        <div class="channel-url">${escapeHtml(c.base_url)}</div>
        <dl>
          <div><dt>优先级</dt><dd>${c.priority}</dd></div>
          <div><dt>失败</dt><dd>${c.consecutive_failures}/${c.failure_threshold}</dd></div>
          <div><dt>超时</dt><dd>${c.timeout_ms}ms</dd></div>
          <div><dt>冷却</dt><dd>${c.cooldown_seconds}s</dd></div>
        </dl>
        <p class="channel-meta">最后成功：${fmtDate(c.last_success_at)} ｜ 最后失败：${fmtDate(c.last_failure_at)}</p>
        ${c.last_error ? `<p class="channel-error">${escapeHtml(c.last_error)}</p>` : ''}
        <div class="channel-actions">
          <button class="btn btn-sm btn-secondary edit-channel" data-id="${c.id}">编辑</button>
          <button class="btn btn-sm btn-quiet reset-channel" data-id="${c.id}">重置熔断</button>
          <button class="btn btn-sm btn-danger delete-channel" data-id="${c.id}">删除</button>
        </div>
      </article>`;
  }).join('');
}

function renderChannelForm(channel = {}) {
  return `
    <form id="channel-form" class="channel-form">
      <input type="hidden" id="channel-id" value="${channel.id || ''}">
      <label>渠道名称<input id="channel-name" value="${escapeHtml(channel.name || '')}" placeholder="例如：主力 OpenAI 中转"></label>
      <label>Base URL<input id="channel-base-url" value="${escapeHtml(channel.base_url || '')}" placeholder="https://relay.example.com"></label>
      <label>API Key<input id="channel-api-key" type="password" value="" placeholder="${channel.id ? '留空则保留当前 key' : 'sk-...'}"></label>
      <div class="settings-grid compact">
        <label>优先级<input id="channel-priority" type="number" value="${channel.priority ?? 100}"></label>
        <label>超时 ms<input id="channel-timeout" type="number" min="1000" value="${channel.timeout_ms ?? 120000}"></label>
        <label>失败阈值<input id="channel-threshold" type="number" min="1" max="20" value="${channel.failure_threshold ?? 2}"></label>
        <label>冷却秒数<input id="channel-cooldown" type="number" min="10" value="${channel.cooldown_seconds ?? 300}"></label>
      </div>
      <label class="toggle-row"><input id="channel-enabled" type="checkbox" ${channel.enabled === false ? '' : 'checked'}> 启用渠道</label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${channel.id ? '保存渠道' : '创建渠道'}</button>
        <button class="btn btn-quiet" type="button" id="clear-channel-form">清空</button>
      </div>
    </form>`;
}

function bindSettingsEvents() {
  document.getElementById('new-channel').onclick = () => {
    document.getElementById('channel-form-title').textContent = '新增渠道';
    document.querySelector('.split-grid .card:nth-child(2)').innerHTML = `
      <div class="card-header"><div><h3 id="channel-form-title">新增渠道</h3><p>API Key 保存后不会在列表中明文展示。</p></div></div>
      ${renderChannelForm()}`;
    bindChannelForm();
  };
  bindChannelForm();

  document.querySelectorAll('.edit-channel').forEach((btn) => {
    btn.onclick = () => {
      const channel = cachedChannels.find((item) => String(item.id) === btn.dataset.id);
      if (!channel) return;
      document.querySelector('.split-grid .card:nth-child(2)').innerHTML = `
        <div class="card-header"><div><h3 id="channel-form-title">编辑渠道</h3><p>API Key 留空则保留当前值。</p></div></div>
        ${renderChannelForm(channel)}`;
      bindChannelForm();
    };
  });

  document.querySelectorAll('.reset-channel').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await request(`/channels/${btn.dataset.id}/reset`, { method: 'POST' });
        toast('熔断状态已重置');
        renderContent();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  document.querySelectorAll('.delete-channel').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('确定删除这个渠道？')) return;
      try {
        await request(`/channels/${btn.dataset.id}`, { method: 'DELETE' });
        toast('渠道已删除');
        renderContent();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  document.getElementById('save-settings').onclick = async () => {
    try {
      const bonus = document.getElementById('s-checkin_consecutive_bonus').value;
      JSON.parse(bonus);
      await request('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          default_model: document.getElementById('s-default_model').value,
          points_per_generation: document.getElementById('s-points_per_generation').value,
          checkin_points: document.getElementById('s-checkin_points').value,
          checkin_consecutive_bonus: bonus,
        }),
      });
      toast('系统策略已保存');
      renderContent();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

function bindChannelForm() {
  const form = document.getElementById('channel-form');
  if (!form) return;
  document.getElementById('clear-channel-form').onclick = () => {
    document.getElementById('channel-form-title').textContent = '新增渠道';
    document.querySelector('.split-grid .card:nth-child(2)').innerHTML = `
      <div class="card-header"><div><h3 id="channel-form-title">新增渠道</h3><p>API Key 保存后不会在列表中明文展示。</p></div></div>
      ${renderChannelForm()}`;
    bindChannelForm();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('channel-id').value;
    const payload = {
      name: document.getElementById('channel-name').value,
      base_url: document.getElementById('channel-base-url').value,
      api_key: document.getElementById('channel-api-key').value,
      enabled: document.getElementById('channel-enabled').checked,
      priority: intValue('channel-priority', 100),
      timeout_ms: intValue('channel-timeout', 120000),
      failure_threshold: intValue('channel-threshold', 3),
      cooldown_seconds: intValue('channel-cooldown', 300),
    };
    try {
      await request(id ? `/channels/${id}` : '/channels', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      toast(id ? '渠道已更新' : '渠道已创建');
      renderContent();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

async function renderUsers(el) {
  const data = await request('/users?page=1&pageSize=20');
  el.innerHTML = `
    ${pageHeader('用户管理', '查看用户积分、签到状态，并为用户手动充值。')}
    <section class="card">
      <table>
        <thead><tr><th>ID</th><th>昵称</th><th>OpenID</th><th>积分</th><th>连续签到</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>${data.list.map((u) => `
          <tr>
            <td>${u.id}</td>
            <td>${escapeHtml(u.nickname || '-')}</td>
            <td class="mono">${escapeHtml(u.openid)}</td>
            <td><span class="pill warm">${u.points}</span></td>
            <td>${u.consecutive_checkins} 天</td>
            <td>${fmtDate(u.created_at)}</td>
            <td><button class="btn btn-sm btn-secondary recharge-btn" data-id="${u.id}" data-name="${escapeHtml(u.nickname || u.id)}">充值</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </section>`;

  document.querySelectorAll('.recharge-btn').forEach((btn) => {
    btn.onclick = () => showRechargeModal(btn.dataset.id, btn.dataset.name);
  });
}

function showRechargeModal(userId, userName) {
  closeModal();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card">
      <button class="modal-close" type="button" aria-label="关闭">×</button>
      <p class="eyebrow">POINTS RECHARGE</p>
      <h3>为用户充值</h3>
      <div class="modal-user">
        <span>用户</span>
        <strong>${escapeHtml(userName)}</strong>
        <small>ID ${escapeHtml(userId)}</small>
      </div>
      <form id="recharge-form">
        <label>充值积分
          <input id="recharge-amount" type="number" min="1" step="1" value="10" autofocus>
        </label>
        <label>备注
          <input id="recharge-remark" value="管理员充值" maxlength="80">
        </label>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" id="recharge-cancel">取消</button>
          <button class="btn btn-primary" type="submit" id="recharge-submit">确认充值</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(modal);
  const amountInput = document.getElementById('recharge-amount');
  amountInput.focus();
  amountInput.select();

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
  modal.querySelector('.modal-close').onclick = closeModal;
  document.getElementById('recharge-cancel').onclick = closeModal;
  document.getElementById('recharge-form').onsubmit = async (e) => {
    e.preventDefault();
    const amount = Number(document.getElementById('recharge-amount').value);
    const remark = document.getElementById('recharge-remark').value.trim() || '管理员充值';
    if (!Number.isInteger(amount) || amount <= 0) {
      toast('请输入大于 0 的整数积分', 'error');
      return;
    }
    const submit = document.getElementById('recharge-submit');
    submit.disabled = true;
    submit.textContent = '提交中...';
    try {
      await request(`/users/${userId}/recharge`, {
        method: 'POST',
        body: JSON.stringify({ amount, remark }),
      });
      closeModal();
      toast('充值成功');
      renderContent();
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = '确认充值';
    }
  };
}

async function renderGenerations(el) {
  const data = await request('/generations?page=1&pageSize=20');
  const statusLabel = { pending: '生成中', success: '成功', failed: '失败' };
  const typeLabel = { text2img: '文生图', img2img: '图片编辑' };
  el.innerHTML = `
    ${pageHeader('生成记录', '追踪用户请求、模型、渠道命中和失败原因。')}
    <section class="card">
      <table>
        <thead><tr><th>ID</th><th>用户</th><th>类型</th><th>提示词</th><th>模型</th><th>渠道</th><th>状态</th><th>失败原因</th><th>时间</th></tr></thead>
        <tbody>${data.list.map((g) => `
          <tr>
            <td>${g.id}</td>
            <td>${escapeHtml(g.user_nickname || g.user_id || '-')}</td>
            <td>${typeLabel[g.type] || g.type}</td>
            <td class="prompt-cell" title="${escapeHtml(g.prompt)}">${escapeHtml(g.prompt)}</td>
            <td>${escapeHtml(g.model)}</td>
            <td>${escapeHtml(g.channel_name || channelFallback(g.error_message))}</td>
            <td><span class="pill ${g.status === 'failed' ? 'bad' : ''}">${statusLabel[g.status] || g.status}</span></td>
            <td class="prompt-cell" title="${escapeHtml(g.error_message || '')}">${escapeHtml(g.error_message || '-')}</td>
            <td>${fmtDate(g.created_at)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </section>`;
}

function channelFallback(errorMessage) {
  if (!errorMessage) return '-';
  if (errorMessage.includes('没有可用的中转站渠道')) return '无可用渠道';
  if (errorMessage.includes('source_image') || errorMessage.includes('no such file') || errorMessage.includes('ENOENT')) return '本地文件';
  return '选择前/聚合失败';
}

async function renderCdk(el) {
  const data = await request('/cdk/list?page=1&pageSize=20');
  el.innerHTML = `
    ${pageHeader('CDK 管理', '批量生成积分兑换码，支持运营发放。')}
    <section class="card cdk-maker">
      <label>积分数量<input id="cdk-points" type="number" value="10" min="1"></label>
      <label>生成数量<input id="cdk-count" type="number" value="10" min="1" max="1000"></label>
      <button class="btn btn-primary" id="cdk-gen-btn">生成兑换码</button>
      <div id="cdk-result"></div>
    </section>
    <section class="card">
      <table>
        <thead><tr><th>兑换码</th><th>积分</th><th>状态</th><th>使用者</th><th>创建者</th><th>创建时间</th></tr></thead>
        <tbody>${data.list.map((c) => `
          <tr>
            <td class="mono">${escapeHtml(c.code)}</td>
            <td>${c.points}</td>
            <td><span class="pill ${c.status === 'unused' ? '' : 'bad'}">${c.status === 'unused' ? '未使用' : '已使用'}</span></td>
            <td>${escapeHtml(c.user_nickname || '-')}</td>
            <td>${escapeHtml(c.admin_username || '-')}</td>
            <td>${fmtDate(c.created_at)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </section>`;

  document.getElementById('cdk-gen-btn').onclick = async () => {
    try {
      const res = await request('/cdk/generate', {
        method: 'POST',
        body: JSON.stringify({
          points: Number(document.getElementById('cdk-points').value),
          count: Number(document.getElementById('cdk-count').value),
        }),
      });
      document.getElementById('cdk-result').innerHTML = `
        <div class="code-box">
          <strong>已生成 ${res.count} 个兑换码</strong>
          <pre>${escapeHtml(res.codes.join('\n'))}</pre>
          <button class="btn btn-sm btn-secondary" id="copy-codes">复制全部</button>
        </div>`;
      document.getElementById('copy-codes').onclick = () => {
        navigator.clipboard.writeText(res.codes.join('\n'));
        toast('已复制到剪贴板');
      };
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

render();
