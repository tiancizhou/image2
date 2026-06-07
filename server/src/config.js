require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: '7d',
  wxAppId: process.env.WX_APPID,
  wxSecret: process.env.WX_SECRET,
  uploadDir: 'uploads',
};
