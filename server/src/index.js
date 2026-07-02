const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db/pool');
const errorHandler = require('./middleware/error-handler');
const authRoutes = require('./routes/auth');
const imageRoutes = require('./routes/images');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const lotteryRoutes = require('./routes/lottery');
const generationWorker = require('./services/generation-worker');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件：生成的图片。文件名唯一，允许客户端长缓存，历史列表二次进入会快很多。
app.use('/uploads', express.static(path.join(__dirname, '..', config.uploadDir), {
  maxAge: '30d',
  immutable: true,
}));

// 管理后台静态页面
app.use('/admin', express.static(path.join(__dirname, 'admin', 'public')));

// PC 用户端静态页面
app.use('/pc', express.static(path.join(__dirname, 'pc', 'public')));

// H5 用户端静态页面
app.use('/h5', express.static(path.join(__dirname, 'h5', 'public')));

// H5 抽奖活动页
app.use('/lottery', express.static(path.join(__dirname, 'lottery', 'public')));

// 小程序 API
app.use('/api/auth', authRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/user', userRoutes);
app.use('/api/lottery', lotteryRoutes);

// 管理后台 API
app.use('/admin/api', adminRoutes);

// 管理后台 SPA fallback
app.get('/admin/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'public', 'index.html'));
});

// PC 用户端 SPA fallback
app.get('/pc/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'pc', 'public', 'index.html'));
});

// H5 用户端 SPA fallback
app.get('/h5/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'h5', 'public', 'index.html'));
});

// H5 抽奖活动页 fallback
app.get('/lottery/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'lottery', 'public', 'index.html'));
});

app.use(errorHandler);

async function bootstrap() {
  // 自动初始化数据库表
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await db.query(schema);
  console.log('Database schema ready');

  // 自动创建管理员账号
  const bcrypt = require('bcryptjs');
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(adminPass, 10);
  await db.query(
    `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2`,
    [adminUser, hash]
  );
  console.log(`Admin ready: ${adminUser}`);
  await generationWorker.restorePendingJobs();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
