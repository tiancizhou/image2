const { request, ensureLogin } = require('../../utils/api');
const app = getApp();

function resolveImageUrl(path) {
  if (!path) return '';
  const first = String(path).split(',')[0].trim();
  if (/^https?:\/\//i.test(first)) return first;
  if (first.startsWith('/')) return `${app.globalData.baseUrl}${first}`;
  return `${app.globalData.baseUrl}/uploads/${first}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    item: null,
    baseUrl: '',
  },

  onLoad(options) {
    this.setData({ baseUrl: app.globalData.baseUrl });
    if (options.id) this.loadDetail(options.id);
  },

  async loadDetail(id) {
    try {
      await ensureLogin();
      const item = await request(`/api/images/${id}`);
      if (item.result_image_path && item.result_image_path.includes(',')) {
        item.result_image_path = item.result_image_path.split(',')[0];
      }
      item.image_url = resolveImageUrl(item.result_image_path);
      item.created_at_text = formatDateTime(item.created_at);
      item.type_text = item.type === 'text2img' ? '文生图' : '图生图';
      this.setData({ item });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onSaveImage() {
    const { item, baseUrl } = this.data;
    if (!item) return;
    const url = item.image_url || resolveImageUrl(item.result_image_path);
    wx.downloadFile({
      url,
      success(res) {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success() { wx.showToast({ title: '已保存', icon: 'success' }); },
          fail() { wx.showToast({ title: '保存失败', icon: 'none' }); },
        });
      },
    });
  },

  onRemix() {
    const { item } = this.data;
    if (!item || item.status !== 'success' || !item.image_url) {
      wx.showToast({ title: '只有已完成图片可以再创作', icon: 'none' });
      return;
    }
    wx.setStorageSync('remix_draft', {
      imageUrl: item.image_url,
      prompt: item.prompt || '',
      size: item.size || '1024x1024',
      sourceId: item.id,
    });
    wx.switchTab({ url: '/pages/index/index' });
  },

  onDelete() {
    const { item } = this.data;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除吗？',
      confirmColor: '#e17055',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await ensureLogin();
          await request(`/api/images/${item.id}`, { method: 'DELETE' });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1000);
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
});
