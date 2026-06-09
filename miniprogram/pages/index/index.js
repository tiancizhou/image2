const { request, uploadFile, ensureLogin, clearLogin } = require('../../utils/api');
const app = getApp();

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
    sourceGenerationId: '',
    sourceFromHistory: false,
    generating: false,
    showTaskModal: false,
    submittedTaskId: '',
    resultImage: '',
    pointsCost: 1,
    userPoints: 0,
    serviceAvailable: false,
    serviceChecked: false,
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

  onLoad() {
    this.loadServiceAvailability();
    this.loadUserPoints();
  },

  onShow() {
    this.loadServiceAvailability();
    this.loadUserPoints();
    if (this.data.serviceAvailable) this.consumeRemixDraft();
  },

  async loadServiceAvailability() {
    try {
      const data = await request('/api/images/availability', { auth: false });
      this.setData({
        serviceAvailable: data.available !== false,
        serviceChecked: true,
      });
    } catch (err) {
      this.setData({ serviceAvailable: false, serviceChecked: true });
    }
  },

  async loadUserPoints() {
    try {
      await ensureLogin();
      const profile = await request('/api/user/profile');
      this.setData({ userPoints: profile.points });
    } catch (err) {
      if (err.message === '用户不存在') {
        clearLogin();
        try {
          await ensureLogin(true);
          const profile = await request('/api/user/profile');
          this.setData({ userPoints: profile.points });
        } catch {}
      }
    }
  },

  onPromptInput(e) {
    const prompt = e.detail.value || '';
    this.setData({ prompt, promptLength: prompt.length });
  },

  onSizeChange(e) {
    this.setData({ size: e.detail.value || e.detail });
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
      sourceGenerationId: draft.sourceId || '',
      sourceFromHistory: true,
      uploadAreaClass: 'has-image',
      size: draft.size || this.data.size,
      prompt,
      promptLength: prompt.length,
      resultImage: '',
    });
    wx.showToast({ title: '已带入上一张图', icon: 'none' });
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({
          sourceImage: file.tempFilePath,
          sourceFilePath: file.tempFilePath,
          sourceGenerationId: '',
          sourceFromHistory: false,
          uploadAreaClass: 'has-image',
          resultImage: '',
        });
      },
    });
  },

  onRemoveSource() {
    this.setData({ sourceImage: '', sourceFilePath: '', sourceGenerationId: '', sourceFromHistory: false, uploadAreaClass: '', resultImage: '' });
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
    const { mode, prompt, size, sourceFilePath, sourceGenerationId, generating, userPoints, pointsCost, imagePromptFallback } = this.data;
    if (generating) return;
    if (!this.data.serviceAvailable) {
      wx.showToast({ title: '请先浏览灵感主题', icon: 'none' });
      return;
    }
    if (mode === 'edit' && !sourceFilePath && !sourceGenerationId) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }
    if (mode === 'generate' && !prompt.trim()) {
      wx.showToast({ title: '请输入提示词', icon: 'none' });
      return;
    }
    if (userPoints < pointsCost) {
      wx.showToast({ title: '积分不足', icon: 'none' });
      return;
    }

    this.syncModeState({ generating: true, resultImage: '' });

    try {
      await ensureLogin();
      const finalPrompt = prompt.trim() || imagePromptFallback;
      let res;
      if (mode === 'edit' && sourceGenerationId) {
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
        res = await uploadFile('/api/images/edit', sourceFilePath, 'image', {
          prompt: finalPrompt,
          model: 'gpt-image-2',
          size,
          n: '1',
        });
      } else {
        res = await request('/api/images/generate', {
          method: 'POST',
          data: { prompt: finalPrompt, model: 'gpt-image-2', size, n: 1 },
        });
      }

      this.setData({
        showTaskModal: true,
        submittedTaskId: res.id,
      });
      this.setData({
        prompt: mode === 'edit' ? prompt : '',
        promptLength: mode === 'edit' ? prompt.length : 0,
        resultImage: '',
      });
      this.loadUserPoints();
    } catch (err) {
      wx.showToast({ title: err.message || (mode === 'edit' ? '编辑失败' : '生成失败'), icon: 'none' });
      this.loadUserPoints();
    } finally {
      this.syncModeState({ generating: false });
    }
  },

  onCloseTaskModal() {
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
