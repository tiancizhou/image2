const { request, ensureLogin } = require('../../utils/api');

const PROFILE_CACHE_KEY = 'profile_summary_cache';
const PROFILE_CACHE_TTL = 5000;
const AUTHOR_WECHAT_CARD = '/static/author-wechat-card.jpg';

Page({
  data: {
    userInfo: {},
    displayName: '绘境用户',
    userCode: '',
    points: 0,
    checkedIn: false,
    showPoints: false,
    pointLogs: [],
    loadingProfile: false,
    lastLoadedAt: 0,
    showCommunity: false,
    showPointLogsPanel: false,
    authorWechatCard: AUTHOR_WECHAT_CARD,
    serviceAvailable: false,
    communityMenuText: '联系作者',
    communityMenuSub: '添加作者微信，交流画面灵感',
    communityBadgeText: '名片码',
    communityTitle: '联系梦倩绘境作者',
    communityDesc: '长按或保存下方微信名片码，添加作者微信后备注「梦倩绘境」，一起交流画面灵感与审美参考。',
  },

  onShow() {
    this.loadServiceAvailability();
    this.renderCachedProfile();
    this.loadProfile();
  },

  async loadServiceAvailability() {
    try {
      const data = await request('/api/images/availability', { auth: false });
      this.applyServiceMode(data.available !== false);
    } catch {
      this.applyServiceMode(false);
    }
  },

  applyServiceMode(serviceAvailable) {
    this.setData({
      serviceAvailable,
      showPointLogsPanel: serviceAvailable && this.data.showPoints,
      communityMenuText: serviceAvailable ? '加交流群领积分' : '联系作者',
      communityMenuSub: serviceAvailable ? '添加作者微信，进群领取福利' : '添加作者微信，交流画面灵感',
      communityBadgeText: serviceAvailable ? '福利' : '名片码',
      communityTitle: serviceAvailable ? '加入梦倩绘境交流群' : '联系梦倩绘境作者',
      communityDesc: serviceAvailable
        ? '长按或保存下方微信名片码，添加作者微信后备注「梦倩绘境」，进群领取积分和交流提示词。'
        : '长按或保存下方微信名片码，添加作者微信后备注「梦倩绘境」，一起交流画面灵感与审美参考。',
    });
  },

  renderCachedProfile() {
    const cached = wx.getStorageSync(PROFILE_CACHE_KEY);
    if (!cached || !cached.profile) return;
    this.applyProfile(cached.profile, cached.checkin);
  },

  async loadProfile() {
    if (this.data.loadingProfile) return;
    const now = Date.now();
    if (now - this.data.lastLoadedAt < PROFILE_CACHE_TTL) return;
    this.setData({ loadingProfile: true });
    try {
      await ensureLogin();
      const summary = await request('/api/user/profile/summary');
      wx.setStorageSync(PROFILE_CACHE_KEY, summary);
      this.applyProfile(summary.profile, summary.checkin);
      this.setData({ lastLoadedAt: Date.now(), loadingProfile: false });
    } catch {
      this.setData({ loadingProfile: false });
    }
  },

  applyProfile(profile, checkin = {}) {
    this.setData({
      userInfo: profile,
      displayName: `绘境用户 #${profile.id}`,
      userCode: `UID ${profile.id}`,
      points: profile.points || 0,
      checkedIn: !!checkin.checkedIn,
    });
  },

  goCheckin() {
    if (!this.data.serviceAvailable) return;
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },

  goCdk() {
    if (!this.data.serviceAvailable) return;
    wx.navigateTo({ url: '/pages/cdk/cdk' });
  },

  async goPoints() {
    if (this.data.showPoints) {
      this.setData({ showPoints: false, showPointLogsPanel: false });
      return;
    }
    if (this.data.pointLogs.length > 0) {
      this.setData({ showPoints: true, showPointLogsPanel: this.data.serviceAvailable });
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
      this.setData({ pointLogs, showPoints: true, showPointLogsPanel: this.data.serviceAvailable });
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

  openCommunity() {
    this.setData({ showCommunity: true });
  },

  closeCommunity() {
    this.setData({ showCommunity: false });
  },

  previewWechatCard() {
    wx.previewImage({
      current: this.data.authorWechatCard,
      urls: [this.data.authorWechatCard],
    });
  },

  onShareAppMessage() {
    return {
      title: '梦倩绘境：把灵感画成梦境',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '梦倩绘境：把灵感画成梦境',
      query: '',
    };
  },
});
