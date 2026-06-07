const { request, ensureLogin } = require('../../utils/api');

Page({
  data: {
    checkedIn: false,
    consecutive: 0,
    bonusHint: '',
  },

  onLoad() {
    this.loadStatus();
  },

  async loadStatus() {
    try {
      await ensureLogin();
      const status = await request('/api/user/checkin/status');
      const consecutive = status.consecutive || 0;
      let bonusHint = '';
      if (consecutive > 0) {
        if (consecutive < 7) bonusHint = `再坚持 ${7 - consecutive} 天可获得连续签到奖励`;
        else bonusHint = '太棒了！继续保持签到吧~';
      }
      this.setData({ checkedIn: status.checkedIn, consecutive, bonusHint });
    } catch {}
  },

  async onCheckin() {
    if (this.data.checkedIn) return;
    try {
      await ensureLogin();
      const res = await request('/api/user/checkin', { method: 'POST' });
      this.setData({ checkedIn: true, consecutive: res.consecutive });
      let msg = `签到成功！获得 ${res.points} 积分`;
      if (res.bonusPoints > 0) msg += `（含连续签到奖励 ${res.bonusPoints}）`;
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
