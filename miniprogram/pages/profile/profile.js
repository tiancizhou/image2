const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    userInfo: {},
    checkedIn: false,
    showPoints: false,
    pointLogs: [],
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    try {
      await ensureLogin();
      const profile = await request('/api/user/profile');
      const status = await request('/api/user/checkin/status');
      this.setData({ userInfo: profile, checkedIn: status.checkedIn });
    } catch {}
  },

  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },

  goCdk() {
    wx.navigateTo({ url: '/pages/cdk/cdk' });
  },

  async goPoints() {
    if (this.data.showPoints) {
      this.setData({ showPoints: false });
      return;
    }
    try {
      const res = await request('/api/user/points?page=1&pageSize=20');
      this.setData({ pointLogs: res.list, showPoints: true });
    } catch {}
  },
});
