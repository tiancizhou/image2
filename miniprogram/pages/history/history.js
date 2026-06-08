const { request, ensureLogin } = require('../../utils/api');
const app = getApp();

function resolveImageUrl(path) {
  if (!path) return '';
  const first = String(path).split(',')[0].trim();
  if (/^https?:\/\//i.test(first)) return first;
  if (first.startsWith('/')) return `${app.globalData.baseUrl}${first}`;
  return `${app.globalData.baseUrl}/uploads/${first}`;
}

function statusText(status) {
  if (status === 'pending') return '生成中';
  if (status === 'failed') return '失败';
  return '已完成';
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
    list: [],
    page: 1,
    hasMore: true,
    loading: false,
    baseUrl: '',
    polling: false,
  },

  onLoad() {
    this.setData({ baseUrl: app.globalData.baseUrl });
  },

  onShow() {
    this.setData({ list: [], page: 1, hasMore: true });
    this.loadList();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async loadList() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      await ensureLogin();
      const res = await request(`/api/images/history?page=${this.data.page}&pageSize=20`);
      const normalized = res.list.map(item => ({
        ...item,
        image_url: resolveImageUrl(item.result_image_path),
        status_text: statusText(item.status),
        status_class: item.status === 'failed' ? 'failed' : (item.status === 'pending' ? 'pending' : 'success'),
        created_at_text: formatDateTime(item.created_at),
      }));
      const newList = this.data.list.concat(normalized);
      this.setData({
        list: newList,
        hasMore: newList.length < res.total,
        loading: false,
      });
      this.updatePolling();
    } catch {
      this.setData({ loading: false });
    }
  },

  async refreshFirstPage() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await ensureLogin();
      const res = await request('/api/images/history?page=1&pageSize=20');
      const normalized = res.list.map(item => ({
        ...item,
        image_url: resolveImageUrl(item.result_image_path),
        status_text: statusText(item.status),
        status_class: item.status === 'failed' ? 'failed' : (item.status === 'pending' ? 'pending' : 'success'),
        created_at_text: formatDateTime(item.created_at),
      }));
      this.setData({
        list: normalized,
        page: 2,
        hasMore: normalized.length < res.total,
        loading: false,
      });
      this.updatePolling();
    } catch {
      this.setData({ loading: false });
    }
  },

  updatePolling() {
    const hasPending = this.data.list.some(item => item.status === 'pending');
    if (hasPending) this.startPolling();
    else this.stopPolling();
  },

  startPolling() {
    if (this.pollTimer) return;
    this.setData({ polling: true });
    this.pollTimer = setInterval(() => {
      this.refreshFirstPage();
    }, 3000);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.data.polling) this.setData({ polling: false });
  },

  loadMore() {
    this.setData({ page: this.data.page + 1 });
    this.loadList();
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  onPullDownRefresh() {
    this.setData({ list: [], page: 1, hasMore: true });
    this.loadList().then(() => wx.stopPullDownRefresh());
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
