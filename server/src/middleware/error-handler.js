module.exports = (err, req, res, _next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);
  const status = err.status || 500;
  const message = status === 500 ? '服务器内部错误' : err.message;
  res.status(status).json({ error: message });
};
