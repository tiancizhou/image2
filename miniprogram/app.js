App({
  globalData: {
    baseUrl: 'http://127.0.0.1:4000',
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
