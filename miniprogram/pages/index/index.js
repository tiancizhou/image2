const { request, uploadFile, ensureLogin, clearLogin } = require('../../utils/api');
const { withInvite, inviteQuery } = require('../../utils/invite');
const app = getApp();

const REWARDED_AD_UNIT_ID = 'adunit-7c1171d810b25c91';

let videoAd = null;
let videoAdReady = false;
let videoAdRewardResolver = null;

Page({
  data: {
    mode: 'generate',
    isEditMode: false,
    modeGenerateClass: 'active',
    modeEditClass: '',
    uploadAreaClass: '',
    promptLabel: '画面描述',
    promptPlaceholder: '例如：一只漂浮在太空里的猫，电影感打光，超细节...',
    actionVerb: '生成',
    actionText: '开始生成',
    loadingText: 'AI 正在绘制画面，请稍候...',
    resultLabel: '生成结果',
    createBtnClass: '',
    imagePromptFallback: '参考上传图片，保留主体特征与构图氛围，生成一张完成度更高、细节更丰富的图片。',
    prompt: '',
    promptLength: 0,
    size: '1024x1024',
    sourceImage: '',
    sourceFilePath: '',
    sourceImages: [],
    sourceFilePaths: [],
    sourceUploadedFiles: [],
    sourceGenerationId: '',
    sourceFromHistory: false,
    generating: false,
    showQuickCheckin: false,
    quickCheckinLoading: false,
    checkinPromptChecking: false,
    checkinPromptChecked: false,
    checkedInToday: false,
    checkinConsecutive: 0,
    quickCheckinRewardText: '每日签到可领取积分',
    rewardAdLoading: false,
    rewardAdPoints: 1,
    showTaskModal: false,
    taskAccepted: false,
    taskSubmittingText: '正在提交创作任务...',
    submittedTaskId: '',
    resultImage: '',
    pointsCost: 1,
    sizePricing: {
      '1024x1024': 1,
      '1536x1024': 2,
      '1024x1536': 2,
      '2048x2048': 2,
      '3840x2160': 4,
    },
    userPoints: 0,
    reviewMode: false,
    serviceAvailable: false,
    serviceChecked: false,
    communityTitle: '加入梦倩绘境交流群',
    communityDesc: '添加作者微信，进群领取积分福利，交流提示词和画面审美参考。',
    communityButtonText: '查看名片码',
    communityImageUrl: '/static/author-wechat-card.jpg',
    showCommunityCard: false,
    communityImageLoaded: false,
    previewVisible: false,
    previewItem: null,
    galleryItems: [
      {
        id: 'morning-window',
        title: '晨光窗边',
        image: '/static/gallery/morning-window.svg',
        desc: '奶油白窗帘、浅金阳光、木质桌面，适合温柔日常感。',
        detail: '画面建议：主体靠近窗边，背景保留大面积留白，用浅金色光线制造安静、柔和的氛围。',
      },
      {
        id: 'floating-cloud',
        title: '云上漫游',
        image: '/static/gallery/floating-cloud.svg',
        desc: '低饱和蓝天、蓬松云层、轻盈主体，适合梦境旅行主题。',
        detail: '画面建议：把主体放在画面下三分之一，天空占更多空间，使用蓝白渐变增强空气感。',
      },
      {
        id: 'rainy-neon',
        title: '雨夜霓虹',
        image: '/static/gallery/rainy-neon.svg',
        desc: '深色街景、粉橙反光、玻璃雨滴，适合故事感画面。',
        detail: '画面建议：用雨滴和地面反光增加层次，霓虹色控制在局部，避免画面过于杂乱。',
      },
      {
        id: 'quiet-garden',
        title: '静谧花园',
        image: '/static/gallery/quiet-garden.svg',
        desc: '橄榄绿、雾面白、柔焦花丛，适合自然治愈氛围。',
        detail: '画面建议：前景放少量虚化枝叶，中景安排主体，背景保持柔焦，让画面更有纵深。',
      },
    ],
  },

  async onLoad() {
    this.initRewardedVideoAd();
    await this.loadPublicConfig();
    this.loadServiceAvailability();
    if (!this.data.reviewMode) this.loadPricing();
    this.loadUserPoints();
  },

  async onShow() {
    await this.loadPublicConfig();
    this.loadServiceAvailability();
    if (!this.data.reviewMode) this.loadPricing();
    this.loadUserPoints();
    if (!this.data.reviewMode && this.data.serviceAvailable) this.consumeRemixDraft();
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
        rewardAdPoints: Number(data.rewardAdPoints) > 0 ? Number(data.rewardAdPoints) : this.data.rewardAdPoints,
        communityTitle: community.title || this.data.communityTitle,
        communityDesc: community.desc || this.data.communityDesc,
        communityButtonText: community.buttonText || this.data.communityButtonText,
        communityImageUrl: this.resolveAssetUrl(community.imageUrl || this.data.communityImageUrl),
        communityImageLoaded: false,
      });
      this.preloadCommunityImage();
    } catch {}
  },

  preloadCommunityImage() {
    const imageUrl = this.data.communityImageUrl;
    if (!imageUrl || !wx.getImageInfo) return;
    wx.getImageInfo({
      src: imageUrl,
      success: () => this.setData({ communityImageLoaded: true }),
      fail: () => this.setData({ communityImageLoaded: false }),
    });
  },

  async loadServiceAvailability() {
    if (this.data.reviewMode) {
      this.setData({ serviceAvailable: false, serviceChecked: true });
      this.maybeShowQuickCheckin();
      return;
    }
    try {
      const data = await request('/api/images/availability', { auth: false });
      this.setData({
        serviceAvailable: data.available !== false,
        serviceChecked: true,
      });
      this.maybeShowQuickCheckin();
    } catch (err) {
      this.setData({ serviceAvailable: false, serviceChecked: true });
      this.maybeShowQuickCheckin();
    }
  },

  async loadUserPoints() {
    try {
      await ensureLogin();
      const profile = await request('/api/user/profile');
      app.globalData.userInfo = profile;
      wx.setStorageSync('my_invite_code', profile.invite_code || profile.id);
      this.setData({ userPoints: profile.points });
      this.maybeShowQuickCheckin();
    } catch (err) {
      if (err.message === '用户不存在') {
        clearLogin();
        try {
          await ensureLogin(true);
          const profile = await request('/api/user/profile');
          app.globalData.userInfo = profile;
          wx.setStorageSync('my_invite_code', profile.invite_code || profile.id);
          this.setData({ userPoints: profile.points });
          this.maybeShowQuickCheckin();
        } catch {}
      }
    }
  },

  todayKey() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  },

  async maybeShowQuickCheckin() {
    if (this.data.checkinPromptChecking || this.data.checkinPromptChecked) return;
    const dismissKey = `quick_checkin_dismissed_${this.todayKey()}`;
    if (wx.getStorageSync(dismissKey)) {
      this.setData({ checkinPromptChecked: true });
      return;
    }

    this.setData({ checkinPromptChecking: true });
    try {
      await ensureLogin();
      const status = await request('/api/user/checkin/status');
      this.setData({
        checkinPromptChecked: true,
        checkinPromptChecking: false,
        checkedInToday: !!status.checkedIn,
        checkinConsecutive: status.consecutive || 0,
        showQuickCheckin: !status.checkedIn,
        quickCheckinRewardText: status.consecutive > 0
          ? `已连续 ${status.consecutive} 天，今天签到继续累积奖励`
          : '完成今日签到，立即领取积分奖励',
      });
    } catch {
      this.setData({ checkinPromptChecked: true, checkinPromptChecking: false });
    }
  },

  onCloseQuickCheckin() {
    wx.setStorageSync(`quick_checkin_dismissed_${this.todayKey()}`, '1');
    this.setData({ showQuickCheckin: false });
  },

  async onQuickCheckin() {
    if (this.data.quickCheckinLoading) return;
    this.setData({ quickCheckinLoading: true });
    try {
      await ensureLogin();
      const res = await request('/api/user/checkin', { method: 'POST' });
      let msg = `签到成功，获得 ${res.points} 积分`;
      if (res.bonusPoints > 0) msg += `，含连续奖励 ${res.bonusPoints}`;
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
      this.setData({
        showQuickCheckin: false,
        quickCheckinLoading: false,
        checkedInToday: true,
        checkinConsecutive: res.consecutive || this.data.checkinConsecutive,
      });
      wx.setStorageSync(`quick_checkin_dismissed_${this.todayKey()}`, '1');
      this.loadUserPoints();
    } catch (err) {
      this.setData({ quickCheckinLoading: false });
      wx.showToast({ title: err.message || '签到失败', icon: 'none' });
      if (err.message && err.message.includes('已签到')) {
        this.setData({ showQuickCheckin: false });
      }
    }
  },

  initRewardedVideoAd() {
    if (!wx.createRewardedVideoAd || videoAd) return;
    videoAd = wx.createRewardedVideoAd({ adUnitId: REWARDED_AD_UNIT_ID });
    videoAd.onLoad(() => {
      videoAdReady = true;
    });
    videoAd.onError((err) => {
      videoAdReady = false;
      console.error('激励视频广告加载失败', err);
      if (videoAdRewardResolver) {
        videoAdRewardResolver.reject(new Error('广告加载失败，请稍后再试'));
        videoAdRewardResolver = null;
      }
    });
    videoAd.onClose((res) => {
      if (!videoAdRewardResolver) return;
      const resolver = videoAdRewardResolver;
      videoAdRewardResolver = null;
      if (!res || res.isEnded) {
        resolver.resolve();
      } else {
        resolver.reject(new Error('需要完整观看广告后才能获得积分'));
      }
    });
  },

  showRewardedVideoAd() {
    return new Promise((resolve, reject) => {
      if (!wx.createRewardedVideoAd) {
        reject(new Error('当前微信版本暂不支持激励视频广告'));
        return;
      }
      this.initRewardedVideoAd();
      if (!videoAd) {
        reject(new Error('广告组件初始化失败'));
        return;
      }
      videoAdRewardResolver = { resolve, reject };
      videoAd.show().catch(() => videoAd.load().then(() => videoAd.show())).catch((err) => {
        videoAdRewardResolver = null;
        videoAdReady = false;
        console.error('激励视频广告显示失败', err);
        reject(new Error('广告显示失败，请稍后再试'));
      });
    });
  },

  async claimRewardAdPoints() {
    if (this.data.rewardAdLoading) return;
    this.setData({ rewardAdLoading: true });
    await ensureLogin();
    try {
      await this.showRewardedVideoAd();
      const result = await request('/api/user/reward-ad', { method: 'POST' });
      const points = result.points || this.data.rewardAdPoints;
      wx.showToast({ title: `已获得 ${points} 积分`, icon: 'none' });
      this.setData({ userPoints: result.balanceAfter, rewardAdLoading: false });
      this.loadUserPoints();
    } catch (err) {
      this.setData({ rewardAdLoading: false });
      throw err;
    }
  },

  promptRewardAdForPoints() {
    if (this.data.rewardAdLoading) return;
    const insufficient = this.data.userPoints < this.data.pointsCost;
    wx.showModal({
      title: insufficient ? '积分不足' : '领取更多积分',
      content: insufficient
        ? `当前积分不足，本次需要 ${this.data.pointsCost} 积分。完整观看一次广告可获得 ${this.data.rewardAdPoints} 积分。`
        : `完整观看一次广告可获得 ${this.data.rewardAdPoints} 积分，可用于后续使用。`,
      cancelText: '稍后再说',
      confirmText: '看广告',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await this.claimRewardAdPoints();
        } catch (err) {
          wx.showToast({ title: err.message || '领取失败', icon: 'none' });
        }
      },
    });
  },

  async loadPricing() {
    try {
      const pricing = await request('/api/images/pricing', { auth: false });
      const sizePricing = {};
      Object.keys(pricing.sizes || {}).forEach((size) => {
        sizePricing[size] = pricing.sizes[size].points_cost;
      });
      this.setData({
        sizePricing,
        pointsCost: this.getCostForSize(this.data.size, sizePricing),
      });
    } catch (err) {
      this.setData({ pointsCost: this.getCostForSize(this.data.size) });
    }
  },

  getCostForSize(size, pricing = this.data.sizePricing) {
    return pricing[size] !== undefined ? pricing[size] : 1;
  },

  onPromptInput(e) {
    const prompt = e.detail.value || '';
    this.setData({ prompt, promptLength: prompt.length });
  },

  onSizeChange(e) {
    const size = e.detail.value || e.detail;
    this.setData({
      size,
      pointsCost: this.getCostForSize(size),
    });
  },

  syncModeState(extra = {}) {
    const mode = extra.mode || this.data.mode;
    const generating = extra.generating !== undefined ? extra.generating : this.data.generating;
    const isEdit = mode === 'edit';
    this.setData({
      mode,
      isEditMode: isEdit,
      modeGenerateClass: isEdit ? '' : 'active',
      modeEditClass: isEdit ? 'active' : '',
      promptLabel: isEdit ? '编辑描述' : '画面描述',
      promptPlaceholder: isEdit
        ? '可选。例如：保留主体，把背景改成雨夜霓虹街道。不填则自动根据参考图生成。'
        : '例如：一只漂浮在太空里的猫，电影感打光，超细节...',
      actionVerb: isEdit ? '图生图' : '生成',
      actionText: generating ? (isEdit ? '图生图处理中...' : '生成中...') : (isEdit ? '根据图片生成' : '开始生成'),
      loadingText: isEdit ? 'AI 正在参考图片生成，请稍候...' : 'AI 正在绘制画面，请稍候...',
      resultLabel: isEdit ? '图生图结果' : '生成结果',
      createBtnClass: `${isEdit ? 'edit ' : ''}${generating ? 'btn-disabled' : ''}`,
      ...extra,
    });
  },

  switchMode(mode) {
    if (this.data.generating || mode === this.data.mode) return;
    this.syncModeState({ mode, resultImage: '' });
  },

  switchToGenerate() {
    this.switchMode('generate');
  },

  switchToEdit() {
    this.switchMode('edit');
  },

  consumeRemixDraft() {
    const draft = wx.getStorageSync('remix_draft');
    if (!draft || !draft.imageUrl) return;
    wx.removeStorageSync('remix_draft');
    const prompt = draft.prompt ? `基于上一张图重新生成，调整为：` : '';
    this.syncModeState({
      mode: 'edit',
      sourceImage: draft.imageUrl,
      sourceFilePath: '',
      sourceImages: [draft.imageUrl],
      sourceFilePaths: [],
      sourceUploadedFiles: [],
      sourceGenerationId: draft.sourceId || '',
      sourceFromHistory: true,
      uploadAreaClass: 'has-image',
      size: draft.size || this.data.size,
      pointsCost: this.getCostForSize(draft.size || this.data.size),
      prompt,
      promptLength: prompt.length,
      resultImage: '',
    });
    wx.showToast({ title: '已带入上一张图', icon: 'none' });
  },

  onChooseImage() {
    const currentPaths = this.data.sourceFromHistory ? [] : (this.data.sourceFilePaths || []);
    const remaining = 4 - currentPaths.length;
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传 4 张参考图', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = res.tempFiles || [];
        const selectedPaths = files.map(file => file.tempFilePath).filter(Boolean);
        const sourceFilePaths = currentPaths.concat(selectedPaths).filter((file, index, list) => list.indexOf(file) === index).slice(0, 4);
        this.setData({
          sourceImage: sourceFilePaths[0] || '',
          sourceFilePath: sourceFilePaths[0] || '',
          sourceImages: sourceFilePaths,
          sourceFilePaths,
          sourceUploadedFiles: [],
          sourceGenerationId: '',
          sourceFromHistory: false,
          uploadAreaClass: 'has-image',
          resultImage: '',
        });
      },
    });
  },

  onRemoveSource() {
    this.setData({
      sourceImage: '',
      sourceFilePath: '',
      sourceImages: [],
      sourceFilePaths: [],
      sourceUploadedFiles: [],
      sourceGenerationId: '',
      sourceFromHistory: false,
      uploadAreaClass: '',
      resultImage: '',
    });
  },

  onGalleryItemTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.galleryItems.find(option => option.id === id);
    if (!item) return;
    wx.showModal({
      title: item.title,
      content: item.detail,
      cancelText: '关闭',
      confirmText: '查看图片',
      success: (res) => {
        if (!res.confirm) return;
        this.openGalleryPreview(item);
      },
    });
  },

  onGalleryImageTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.galleryItems.find(option => option.id === id);
    if (!item) return;
    this.openGalleryPreview(item);
  },

  openGalleryPreview(item) {
    this.setData({
      previewVisible: true,
      previewItem: item,
    });
  },

  closeGalleryPreview() {
    this.setData({
      previewVisible: false,
      previewItem: null,
    });
  },

  onClosedCheckinTap() {
    if (this.data.checkedInToday) {
      wx.showToast({ title: '今日已签到', icon: 'none' });
      return;
    }
    this.onQuickCheckin();
  },

  onClosedRewardAdTap() {
    this.promptRewardAdForPoints();
  },

  onClosedCommunityTap() {
    const imageUrl = this.data.communityImageUrl;
    if (!imageUrl) {
      wx.showToast({ title: '暂未配置名片码', icon: 'none' });
      return;
    }
    this.setData({ showCommunityCard: true });
  },

  closeCommunityCard() {
    this.setData({ showCommunityCard: false });
  },

  onCommunityImageLoad() {
    this.setData({ communityImageLoaded: true });
  },

  previewCommunityImage() {
    const imageUrl = this.data.communityImageUrl;
    if (!imageUrl) return;
    wx.previewImage({
      current: imageUrl,
      urls: [imageUrl],
    });
  },

  onClosedInviteTap() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
    wx.showToast({ title: '请点击右上角分享给好友', icon: 'none' });
  },

  showGalleryHint(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.galleryItems.find(option => option.id === id);
    if (!item) return;
    wx.showModal({
      title: item.title,
      content: item.detail,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async onCreate() {
    const { mode, prompt, size, sourceFilePaths, sourceUploadedFiles, sourceGenerationId, generating, userPoints, pointsCost, imagePromptFallback } = this.data;
    if (generating) return;
    if (!this.data.serviceAvailable) {
      wx.showToast({ title: '请先浏览灵感主题', icon: 'none' });
      return;
    }
    if (mode === 'edit' && sourceFilePaths.length === 0 && sourceUploadedFiles.length === 0 && !sourceGenerationId) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }
    if (mode === 'generate' && !prompt.trim()) {
      wx.showToast({ title: '请输入提示词', icon: 'none' });
      return;
    }
    if (userPoints < pointsCost) {
      this.promptRewardAdForPoints();
      return;
    }

    this.syncModeState({
      generating: true,
      resultImage: '',
      showTaskModal: true,
      taskAccepted: false,
      submittedTaskId: '',
      taskSubmittingText: mode === 'edit' ? '正在处理参考图...' : '正在提交创作任务...',
    });

    try {
      await ensureLogin();
      const finalPrompt = prompt.trim() || imagePromptFallback;
      let res;
      if (mode === 'edit' && sourceGenerationId) {
        this.setData({ taskSubmittingText: '正在创建图生图任务...' });
        res = await request('/api/images/edit', {
          method: 'POST',
          data: {
            prompt: finalPrompt,
            model: 'gpt-image-2',
            size,
            source_generation_id: sourceGenerationId,
          },
        });
      } else if (mode === 'edit') {
        let uploadedFiles = sourceUploadedFiles;
        if (uploadedFiles.length === 0) {
          uploadedFiles = await this.uploadReferenceImages(sourceFilePaths);
          this.setData({ sourceUploadedFiles: uploadedFiles });
        }
        this.setData({ taskSubmittingText: '正在创建图生图任务...' });
        res = await request('/api/images/edit', {
          method: 'POST',
          data: {
            prompt: finalPrompt,
            model: 'gpt-image-2',
            size,
            n: 1,
            source_images: uploadedFiles.join(','),
          },
        });
      } else {
        this.setData({ taskSubmittingText: '正在创建生图任务...' });
        res = await request('/api/images/generate', {
          method: 'POST',
          data: { prompt: finalPrompt, model: 'gpt-image-2', size, n: 1 },
        });
      }

      this.setData({
        showTaskModal: true,
        taskAccepted: true,
        submittedTaskId: res.id,
      });
      this.setData({
        prompt: mode === 'edit' ? prompt : '',
        promptLength: mode === 'edit' ? prompt.length : 0,
        resultImage: '',
      });
      this.loadUserPoints();
    } catch (err) {
      this.setData({ showTaskModal: false, taskAccepted: false, submittedTaskId: '' });
      wx.showToast({ title: err.message || (mode === 'edit' ? '编辑失败' : '生成失败'), icon: 'none' });
      this.loadUserPoints();
    } finally {
      this.syncModeState({ generating: false });
    }
  },

  async uploadReferenceImages(filePaths) {
    const uniquePaths = filePaths.filter((file, index, list) => file && list.indexOf(file) === index).slice(0, 4);
    this.setData({ taskSubmittingText: `准备上传 ${uniquePaths.length} 张参考图` });
    const uploaded = [];
    for (let index = 0; index < uniquePaths.length; index += 1) {
      this.setData({ taskSubmittingText: `正在压缩参考图 ${index + 1}/${uniquePaths.length}` });
      const uploadPath = await this.compressReferenceImage(uniquePaths[index]);
      const result = await uploadFile('/api/images/references', uploadPath, 'image', {}, {
        timeout: 45000,
        onProgress: (progress) => {
          this.setData({ taskSubmittingText: `正在上传第 ${index + 1}/${uniquePaths.length} 张（${progress.progress || 0}%）` });
        },
      });
      uploaded.push(result.filename);
      this.setData({ taskSubmittingText: `正在上传参考图 ${uploaded.length}/${uniquePaths.length}` });
    }
    return uploaded;
  },

  compressReferenceImage(filePath) {
    return new Promise((resolve) => {
      if (!wx.compressImage) {
        resolve(filePath);
        return;
      }
      wx.compressImage({
        src: filePath,
        quality: 50,
        success: (res) => resolve(res.tempFilePath || filePath),
        fail: () => resolve(filePath),
      });
    });
  },

  onCloseTaskModal() {
    if (!this.data.taskAccepted && this.data.generating) return;
    this.setData({ showTaskModal: false });
  },

  onGoHistory() {
    this.setData({ showTaskModal: false });
    wx.switchTab({ url: '/pages/history/history' });
  },

  noop() {},

  onSaveImage() {
    const { resultImage } = this.data;
    if (!resultImage) return;
    wx.downloadFile({
      url: resultImage,
      success(res) {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success() { wx.showToast({ title: '已保存', icon: 'success' }); },
          fail() { wx.showToast({ title: '保存失败', icon: 'none' }); },
        });
      },
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
