const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    userInfo: {},
    displayName: '绘境用户',
    userCode: '',
    points: 0,
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
      this.setData({
        userInfo: profile,
        displayName: `绘境用户 #${profile.id}`,
        userCode: `UID ${profile.id}`,
        points: profile.points || 0,
        checkedIn: status.checkedIn,
      });
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
      const pointLogs = res.list.map(item => ({
        ...item,
        typeText: this.formatLogType(item.type),
        amountText: `${item.amount > 0 ? '+' : ''}${item.amount}`,
        amountClass: item.amount > 0 ? 'positive' : 'negative',
      }));
      this.setData({ pointLogs, showPoints: true });
    } catch {}
  },

  formatLogType(type) {
    const map = {
      consume: '消费',
      recharge: '充值',
      checkin: '签到',
      cdk: '兑换',
      refund: '返还',
    };
    return map[type] || '积分';
  },
});
