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

function uploadFile(url, filePath, name, formData = {}) {
  return new Promise((resolve, reject) => {
    if (!app.globalData.baseUrl) {
      reject(new Error('未配置后端地址'));
      return;
    }
    const fullUrl = `${app.globalData.baseUrl}${url}`;
    console.log('[api] upload', fullUrl);
    wx.uploadFile({
      url: fullUrl,
      filePath,
      name,
      formData,
      timeout: 120000,
      header: {
        'Authorization': `Bearer ${app.globalData.token}`,
      },
      success(res) {
        const data = JSON.parse(res.data);
        if (res.statusCode >= 400) {
          reject(new Error(data.error || '上传失败'));
          return;
        }
        resolve(data);
      },
      fail(err) {
        console.error('[api] upload failed', fullUrl, err);
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
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
