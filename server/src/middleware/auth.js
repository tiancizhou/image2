const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期' });
  }
};
