App({
  globalData: {
    baseUrl: 'https://image2.qlcc.online',
    token: '',
    userInfo: null,
  },

  onLaunch() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
    }
  },
});
