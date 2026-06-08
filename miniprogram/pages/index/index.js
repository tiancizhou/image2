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
      this.setData({ serviceAvailable: true, serviceChecked: true });
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

  async onCreate() {
    const { mode, prompt, size, sourceFilePath, sourceGenerationId, generating, userPoints, pointsCost, imagePromptFallback } = this.data;
    if (generating) return;
    if (!this.data.serviceAvailable) {
      wx.showToast({ title: '创作服务暂未开放', icon: 'none' });
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
