App({
  globalData: {
    baseUrl: 'https://image2.qlcc.online',
    token: '',
    userInfo: null,
    inviteCode: '',
  },

  onLaunch(options) {
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
    }
    this.captureInviteCode(options);
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline'],
      });
    }
  },

  onShow(options) {
    this.captureInviteCode(options);
  },

  captureInviteCode(options = {}) {
    const query = options.query || {};
    const scene = query.scene ? decodeURIComponent(query.scene) : '';
    const inviteCode = query.inviter || query.invite_code || scene;
    if (!inviteCode) return;
    this.globalData.inviteCode = inviteCode;
    wx.setStorageSync('invite_code', inviteCode);
  },
});
