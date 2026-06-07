const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    code: '',
    result: null,
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.toUpperCase(), result: null });
  },

  async onRedeem() {
    const { code } = this.data;
    if (!code) return;
    try {
      await ensureLogin();
      const res = await request('/api/user/cdk/redeem', {
        method: 'POST',
        data: { code },
      });
      this.setData({ result: res, code: '' });
      wx.showToast({ title: `获得 ${res.points} 积分！`, icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
