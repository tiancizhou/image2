const { uploadFile, ensureLogin, request } = require('../../utils/api');
const app = getApp();

Page({
  data: {
    prompt: '',
    size: '1024x1024',
    sourceImage: '',
    sourceFilePath: '',
    generating: false,
    resultImage: '',
    pointsCost: 1,
    userPoints: 0,
  },

  onLoad() { this.loadUserPoints(); },
  onShow() { this.loadUserPoints(); },

  async loadUserPoints() {
    try {
      await ensureLogin();
      const profile = await request('/api/user/profile');
      this.setData({ userPoints: profile.points });
    } catch {}
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ sourceImage: file.tempFilePath, sourceFilePath: file.tempFilePath });
      },
    });
  },

  onPromptInput(e) { this.setData({ prompt: e.detail.value }); },
  onSizeChange(e) { this.setData({ size: e.detail.value }); },

  async onEdit() {
    const { prompt, size, sourceFilePath, generating, userPoints, pointsCost } = this.data;
    if (generating) return;
    if (!sourceFilePath) { wx.showToast({ title: '请上传图片', icon: 'none' }); return; }
    if (!prompt.trim()) { wx.showToast({ title: '请输入描述', icon: 'none' }); return; }
    if (userPoints < pointsCost) { wx.showToast({ title: '积分不足', icon: 'none' }); return; }

    this.setData({ generating: true, resultImage: '' });

    try {
      await ensureLogin();
      const res = await uploadFile('/api/images/edit', sourceFilePath, 'image', {
        prompt: prompt.trim(),
        model: 'gpt-image-2',
        size,
        n: '1',
      });
      const imageUrl = app.globalData.baseUrl + res.images[0];
      this.setData({ resultImage: imageUrl, userPoints: userPoints - res.points_cost });
    } catch (err) {
      wx.showToast({ title: err.message || '编辑失败', icon: 'none' });
      this.loadUserPoints();
    } finally {
      this.setData({ generating: false });
    }
  },

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
});
