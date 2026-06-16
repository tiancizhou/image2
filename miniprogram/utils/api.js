const app = getApp();

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    if (!app.globalData.baseUrl) {
      reject(new Error('未配置后端地址'));
      return;
    }
    const fullUrl = `${app.globalData.baseUrl}${url}`;
    console.log('[api] request', options.method || 'GET', fullUrl);
    const header = {
      'Content-Type': 'application/json',
      ...options.header,
    };
    if (options.auth !== false) {
      header.Authorization = `Bearer ${app.globalData.token}`;
    }

    wx.request({
      url: fullUrl,
      method: options.method || 'GET',
      data: options.data,
      timeout: options.timeout || 20000,
      header,
      success(res) {
        if (res.statusCode === 401) {
          clearLogin();
          wx.showToast({ title: '请重新登录', icon: 'none' });
          reject(new Error('未登录'));
          return;
        }
        if (res.statusCode >= 400) {
          const message = res.data.error || '请求失败';
          if (res.statusCode === 404 && message === '用户不存在') clearLogin();
          reject(new Error(message));
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        console.error('[api] request failed', fullUrl, err);
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

function uploadFile(url, filePath, name, formData = {}, options = {}) {
  if (!options._retried && !app.globalData.token) {
    return ensureLogin().then(() => uploadFile(url, filePath, name, formData, options));
  }
  return new Promise((resolve, reject) => {
    if (!app.globalData.baseUrl) {
      reject(new Error('未配置后端地址'));
      return;
    }
    const fullUrl = `${app.globalData.baseUrl}${url}`;
    console.log('[api] upload', fullUrl);
    let settled = false;
    const timeout = options.timeout || 45000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('上传参考图超时，请压缩图片或减少数量后重试'));
    }, timeout + 3000);

    const task = wx.uploadFile({
      url: fullUrl,
      filePath,
      name,
      formData,
      timeout,
      header: {
        'Authorization': `Bearer ${app.globalData.token}`,
      },
      success(res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let data = {};
        try {
          data = JSON.parse(res.data || '{}');
        } catch (err) {
          const title = String(res.data || '').match(/<title>(.*?)<\/title>/i)?.[1];
          const reason = title ? `: ${title}` : '';
          reject(new Error(`上传失败，服务器返回非 JSON 响应 ${res.statusCode || ''}${reason}`));
          return;
        }
        if (res.statusCode >= 400) {
          if (res.statusCode === 401 && !options._retried) {
            clearLogin();
            ensureLogin(true)
              .then(() => uploadFile(url, filePath, name, formData, { ...options, _retried: true }))
              .then(resolve)
              .catch(reject);
            return;
          }
          reject(new Error(data.error || '上传失败'));
          return;
        }
        resolve(data);
      },
      fail(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error('[api] upload failed', fullUrl, err);
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
    if (task?.onProgressUpdate && options.onProgress) {
      task.onProgressUpdate(options.onProgress);
    }
  });
}

function clearLogin() {
  wx.removeStorageSync('token');
  app.globalData.token = '';
  app.globalData.userInfo = null;
}

function ensureLogin(force = false) {
  return new Promise((resolve, reject) => {
    if (force) clearLogin();
    if (app.globalData.token) { resolve(); return; }
    wx.login({
      success(loginRes) {
        const inviteCode = app.globalData.inviteCode || wx.getStorageSync('invite_code') || '';
        request('/api/auth/login', {
          method: 'POST',
          data: {
            code: loginRes.code,
            invite_code: inviteCode,
          },
        })
          .then(data => {
            app.globalData.token = data.token;
            app.globalData.userInfo = data.user;
            wx.setStorageSync('token', data.token);
            if (data.user?.invite_code || data.user?.id) {
              wx.setStorageSync('my_invite_code', data.user.invite_code || data.user.id);
            }
            wx.removeStorageSync('invite_code');
            app.globalData.inviteCode = '';
            resolve();
          })
          .catch(reject);
      },
      fail: reject,
    });
  });
}

module.exports = { request, uploadFile, ensureLogin, clearLogin };
