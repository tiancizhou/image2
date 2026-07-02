const { request, ensureLogin } = require('../../utils/api');
const { withInvite, inviteQuery } = require('../../utils/invite');
const app = getApp();
const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 8000;

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
    reviewMode: false,
    serviceAvailable: false,
    serviceChecked: false,
    showPollingTip: false,
    showHistoryGrid: false,
    showEmptyState: false,
    showLoadMore: false,
    retryingId: '',
    previewVisible: false,
    previewItem: null,
    inspirationCollections: [
      {
        id: 'soft-sky',
        title: '柔光天空',
        image: '/static/gallery/floating-cloud.svg',
        desc: '适合搭配白色主体、轻盈云层和低对比阴影。',
        note: '收藏理由：天空面积越大，画面越有呼吸感。建议使用浅蓝、米白和少量金色高光。',
      },
      {
        id: 'clear-color',
        title: '清透色彩',
        image: '/static/gallery/morning-window.svg',
        desc: '降低饱和度，让主体和背景之间保持舒服的距离。',
        note: '收藏理由：清透色彩更适合治愈、梦境、自然主题。避免大面积高饱和紫色或红色。',
      },
      {
        id: 'dream-layout',
        title: '梦境构图',
        image: '/static/gallery/quiet-garden.svg',
        desc: '主体居中或偏下，背景留白，画面更像一段故事。',
        note: '收藏理由：留白能让视线停留更久。可以用前景虚化、远景光斑增强层次。',
      },
    ],
  },

  onLoad() {
    this.setData({ baseUrl: app.globalData.baseUrl });
  },

  onShow() {
    this.loadServiceAvailability();
  },

  async loadReviewMode() {
    try {
      const data = await request('/api/user/public-config', { auth: false });
      this.setData({ reviewMode: data.reviewMode === true });
      return data.reviewMode === true;
    } catch {
      return false;
    }
  },

  async loadServiceAvailability() {
    try {
      const reviewMode = await this.loadReviewMode();
      if (reviewMode) {
        this.setData({
          serviceAvailable: false,
          serviceChecked: true,
          list: [],
          page: 1,
          hasMore: false,
          loading: false,
          showHistoryGrid: false,
          showEmptyState: false,
          showLoadMore: false,
        });
        this.stopPolling();
        return;
      }
      const data = await request('/api/images/availability', { auth: false });
      const serviceAvailable = data.available !== false;
      this.setData({ serviceAvailable, serviceChecked: true });
      if (!serviceAvailable) {
        this.stopPolling();
        this.setData({
          list: [],
          page: 1,
          hasMore: false,
          loading: false,
          showHistoryGrid: false,
          showEmptyState: false,
          showLoadMore: false,
        });
        return;
      }
      this.loadHistoryOnShow();
    } catch {
      this.setData({
        serviceAvailable: false,
        serviceChecked: true,
        list: [],
        page: 1,
        hasMore: false,
        loading: false,
        showHistoryGrid: false,
        showEmptyState: false,
        showLoadMore: false,
      });
      this.stopPolling();
    }
  },

  loadHistoryOnShow() {
    if (this.data.list.length > 0) {
      this.refreshFirstPage();
      return;
    }
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
    if (this.data.loading || !this.data.serviceAvailable) return;
    this.setData({ loading: true });

    try {
      await ensureLogin();
      const res = await request(`/api/images/history?page=${this.data.page}&pageSize=${PAGE_SIZE}`);
      const normalized = res.list.map(item => ({
        ...item,
        image_url: resolveImageUrl(item.result_image_path),
        thumbnail_url: resolveImageUrl(item.thumbnail_image_path || item.result_image_path),
        status_text: statusText(item.status),
        status_class: item.status === 'failed' ? 'failed' : (item.status === 'pending' ? 'pending' : 'success'),
        is_failed: item.status === 'failed',
        retrying: false,
        type_text: item.type === 'img2img' ? '图生图' : '文生图',
        created_at_text: formatDateTime(item.created_at),
      }));
      const newList = this.data.list.concat(normalized);
      this.setData({
        list: newList,
        hasMore: newList.length < res.total,
        loading: false,
      });
      this.updateViewFlags();
      this.updatePolling();
    } catch {
      this.setData({ loading: false });
    }
  },

  async refreshFirstPage() {
    if (this.data.loading || !this.data.serviceAvailable) return;
    this.setData({ loading: true });
    try {
      await ensureLogin();
      const res = await request(`/api/images/history?page=1&pageSize=${PAGE_SIZE}`);
      const normalized = res.list.map(item => ({
        ...item,
        image_url: resolveImageUrl(item.result_image_path),
        thumbnail_url: resolveImageUrl(item.thumbnail_image_path || item.result_image_path),
        status_text: statusText(item.status),
        status_class: item.status === 'failed' ? 'failed' : (item.status === 'pending' ? 'pending' : 'success'),
        is_failed: item.status === 'failed',
        retrying: false,
        type_text: item.type === 'img2img' ? '图生图' : '文生图',
        created_at_text: formatDateTime(item.created_at),
      }));
      this.patchFirstPage(normalized, res.total);
      this.updatePolling();
    } catch {
      this.setData({ loading: false });
    }
  },

  patchFirstPage(nextList, total) {
    const current = this.data.list;
    if (current.length === 0 || current.length !== nextList.length) {
      this.setData({
        list: nextList,
        page: 2,
        hasMore: nextList.length < total,
        loading: false,
      });
      this.updateViewFlags(nextList, nextList.length < total, false);
      return;
    }

    const patch = { loading: false, page: 2, hasMore: nextList.length < total };
    let changed = false;
    nextList.forEach((next, index) => {
      const prev = current[index];
      if (!prev || prev.id !== next.id) {
        patch[`list[${index}]`] = next;
        changed = true;
        return;
      }
      ['status', 'status_text', 'status_class', 'result_image_path', 'thumbnail_image_path', 'image_url', 'thumbnail_url', 'error_message'].forEach((key) => {
        if (prev[key] !== next[key]) {
          patch[`list[${index}].${key}`] = next[key];
          changed = true;
        }
      });
    });
    this.setData(changed ? patch : { loading: false });
    this.updateViewFlags(nextList, nextList.length < total, false);
  },

  updateViewFlags(list = this.data.list, hasMore = this.data.hasMore, loading = this.data.loading) {
    this.setData({
      showHistoryGrid: this.data.serviceAvailable && list.length > 0,
      showEmptyState: this.data.serviceAvailable && !loading && list.length === 0,
      showLoadMore: this.data.serviceAvailable && hasMore,
      showPollingTip: this.data.serviceAvailable && this.data.polling,
    });
  },

  updatePolling() {
    const hasPending = this.data.list.some(item => item.status === 'pending');
    if (hasPending) this.startPolling();
    else this.stopPolling();
  },

  startPolling() {
    if (this.pollTimer) return;
    this.setData({ polling: true, showPollingTip: this.data.serviceAvailable });
    this.pollTimer = setInterval(() => {
      this.refreshFirstPage();
    }, POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.data.polling) this.setData({ polling: false, showPollingTip: false });
  },

  loadMore() {
    if (!this.data.serviceAvailable) return;
    this.setData({ page: this.data.page + 1 });
    this.loadList();
  },

  onIdeaTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.inspirationCollections.find(option => option.id === id);
    if (!item) return;
    wx.showModal({
      title: item.title,
      content: item.note,
      cancelText: '关闭',
      confirmText: '查看图片',
      success: (res) => {
        if (!res.confirm) return;
        this.openCollectionPreview(item);
      },
    });
  },

  onCollectionImageTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.inspirationCollections.find(option => option.id === id);
    if (!item) return;
    this.openCollectionPreview(item);
  },

  openCollectionPreview(item) {
    this.setData({
      previewVisible: true,
      previewItem: item,
    });
  },

  closeCollectionPreview() {
    this.setData({
      previewVisible: false,
      previewItem: null,
    });
  },

  noop() {},

  showCollectionNote(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.inspirationCollections.find(option => option.id === id);
    if (!item) return;
    wx.showModal({
      title: item.title,
      content: item.note,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  async onRetry(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.retryingId) return;
    const index = this.data.list.findIndex(item => String(item.id) === String(id));
    if (index < 0) return;

    this.setData({
      retryingId: id,
      [`list[${index}].retrying`]: true,
    });

    try {
      await ensureLogin();
      const res = await request(`/api/images/${id}/retry`, { method: 'POST' });
      wx.showToast({ title: `已重新提交，冻结 ${res.points_cost} 积分`, icon: 'none' });
      this.setData({ list: [], page: 1, hasMore: true, retryingId: '' });
      await this.loadList();
    } catch (err) {
      wx.showToast({ title: err.message || '重试失败', icon: 'none' });
      this.setData({
        retryingId: '',
        [`list[${index}].retrying`]: false,
      });
    }
  },

  onPullDownRefresh() {
    if (!this.data.serviceAvailable) {
      this.loadServiceAvailability().then(() => wx.stopPullDownRefresh());
      return;
    }
    this.setData({ list: [], page: 1, hasMore: true });
    this.loadList().then(() => wx.stopPullDownRefresh());
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
