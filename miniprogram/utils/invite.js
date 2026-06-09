const app = getApp();

function getInviteCode() {
  return app.globalData.userInfo?.invite_code || app.globalData.userInfo?.id || wx.getStorageSync('my_invite_code') || '';
}

function withInvite(path) {
  const inviteCode = getInviteCode();
  if (!inviteCode) return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}inviter=${encodeURIComponent(inviteCode)}`;
}

function inviteQuery(extra = '') {
  const inviteCode = getInviteCode();
  const parts = [];
  if (extra) parts.push(extra);
  if (inviteCode) parts.push(`inviter=${encodeURIComponent(inviteCode)}`);
  return parts.join('&');
}

module.exports = {
  getInviteCode,
  withInvite,
  inviteQuery,
};
