const { request } = require('../../utils/api');
const app = getApp();

Page({
  data: {
    token: '',
    title: '正在确认网页登录',
    desc: '请稍候，正在将当前微信身份授权给网页端。',
    canRetry: false,
  },

  onLoad(options) {
    const token = decodeURIComponent(options.scene || options.token || '');
    this.setData({ token });
    if (!token) {
      this.setData({
        title: '二维码无效',
        desc: '没有读取到网页登录参数，请回到 PC 端刷新二维码后重试。',
        canRetry: false,
      });
      return;
    }
    this.confirmLogin();
  },

  confirmLogin() {
    const { token } = this.data;
    if (!token) return;
    this.setData({
      title: '正在确认网页登录',
      desc: '请稍候，正在将当前微信身份授权给网页端。',
      canRetry: false,
    });

    wx.login({
      success: async (loginRes) => {
        try {
          const data = await request('/api/auth/web-login/confirm', {
            method: 'POST',
            data: { token, code: loginRes.code },
            auth: false,
          });
          app.globalData.token = data.token;
          app.globalData.userInfo = data.user;
          wx.setStorageSync('token', data.token);
          this.setData({
            title: '网页端已登录',
            desc: 'PC 页面会自动进入创作台。你也可以返回小程序继续使用。',
            canRetry: false,
          });
        } catch (err) {
          this.setData({
            title: '确认失败',
            desc: err.message || '请回到 PC 端刷新二维码后重试。',
            canRetry: true,
          });
        }
      },
      fail: () => {
        this.setData({
          title: '微信登录失败',
          desc: '请检查网络后重试。',
          canRetry: true,
        });
      },
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
