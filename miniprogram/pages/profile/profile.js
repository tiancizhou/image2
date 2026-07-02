const { request, ensureLogin } = require('../../utils/api');
const { withInvite, inviteQuery } = require('../../utils/invite');
const app = getApp();

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
    reviewMode: false,
    serviceAvailable: false,
    communityMenuText: '联系作者',
    communityMenuSub: '添加作者微信，交流画面灵感',
    communityBadgeText: '名片码',
    communityTitle: '联系梦倩绘境作者',
    communityDesc: '长按或保存下方微信名片码，添加作者微信后备注「梦倩绘境」，一起交流画面灵感与审美参考。',
    inviteCode: '',
    inviteRewardText: '好友通过你的链接首次注册成功后，你会获得邀请积分。',
  },

  onShow() {
    this.loadPublicConfig();
    this.loadServiceAvailability();
    this.renderCachedProfile();
    this.loadProfile();
  },

  resolveAssetUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/static/')) return url;
    if (url.startsWith('/')) return `${app.globalData.baseUrl}${url}`;
    return url;
  },

  async loadPublicConfig() {
    try {
      const data = await request('/api/user/public-config', { auth: false });
      const community = data.community || {};
      this.setData({
        reviewMode: data.reviewMode === true,
        communityTitle: community.title || this.data.communityTitle,
        communityDesc: community.desc || this.data.communityDesc,
        communityMenuText: community.title || this.data.communityMenuText,
        communityMenuSub: community.desc || this.data.communityMenuSub,
        communityBadgeText: community.buttonText || this.data.communityBadgeText,
        authorWechatCard: this.resolveAssetUrl(community.imageUrl || this.data.authorWechatCard),
      });
    } catch {}
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
    const enabled = serviceAvailable || this.data.reviewMode;
    this.setData({
      serviceAvailable: enabled,
      showPointLogsPanel: enabled && this.data.showPoints,
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
    app.globalData.userInfo = profile;
    wx.setStorageSync('my_invite_code', profile.invite_code || profile.id);
    this.setData({
      userInfo: profile,
      displayName: `绘境用户 #${profile.id}`,
      userCode: `UID ${profile.id}`,
      inviteCode: profile.invite_code || profile.id,
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
      invite: '邀请',
      reward_ad: '广告奖励',
      lottery: '抽奖',
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
      title: '梦倩绘境积分福利入口',
      path: withInvite('/pages/index/index'),
    };
  },

  onShareTimeline() {
    return {
      title: '梦倩绘境积分福利入口',
      query: inviteQuery(),
    };
  },
});
