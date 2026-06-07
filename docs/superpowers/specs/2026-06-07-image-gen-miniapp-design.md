# AI 图片生成微信小程序 — 设计文档

## 概述

一个公开发布的微信小程序，提供 AI 图片生成（文生图、图片编辑）服务。用户通过积分制使用服务，管理员在后台配置 OpenAI 兼容中转站的 baseUrl 和 apiKey，后端直接调用标准 OpenAI 图片生成接口。

## 技术选型

| 层级 | 技术 |
|------|------|
| 前端 | 微信小程序（原生 WXML/WXSS） |
| 后端 | Node.js + Express |
| 数据库 | PostgreSQL |
| 图片存储 | 服务器本地磁盘，通过 Express 静态文件服务提供访问 |
| 认证 | 小程序端：微信登录 + JWT；管理后台：用户名密码 + JWT |

## 架构

单体 Express 服务，同时提供小程序 API 和管理后台页面：

```
微信小程序  ──→  Express 服务  ──→  OpenAI 兼容中转站 (baseUrl)
管理后台页面 ──→  Express 服务  ──→  PostgreSQL
                    │
                    └──→ 本地图片存储 (/uploads)
```

后端调用流程：拼接 `{baseUrl}/v1/images/generations` 或 `{baseUrl}/v1/images/edits`，在请求头中携带 `Authorization: Bearer {apiKey}`，直接请求中转站。不做任何中间层代理转换，就是一个标准的 OpenAI API 客户端调用。

## 数据模型

### users — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| openid | VARCHAR UNIQUE NOT NULL | 微信 openid |
| nickname | VARCHAR | 昵称 |
| avatar_url | VARCHAR | 头像 URL |
| points | INTEGER DEFAULT 0 | 积分余额 |
| consecutive_checkins | INTEGER DEFAULT 0 | 连续签到天数 |
| last_checkin_date | DATE | 最后签到日期 |
| created_at | TIMESTAMP | 注册时间 |
| last_login_at | TIMESTAMP | 最后登录时间 |

### generations — 生成记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| type | VARCHAR | text2img / img2img |
| prompt | TEXT | 提示词 |
| model | VARCHAR | 模型名称，如 gpt-image-2 |
| size | VARCHAR | 尺寸，如 1024x1024 |
| source_image_path | VARCHAR | 编辑模式的原图路径 |
| result_image_path | VARCHAR | 生成的图片路径 |
| points_cost | INTEGER | 消耗积分数 |
| status | VARCHAR | pending / success / failed |
| error_message | TEXT | 失败原因 |
| created_at | TIMESTAMP | |

### point_logs — 积分变动表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| type | VARCHAR | recharge / consume / checkin / cdk |
| amount | INTEGER | 变动数量（正为增加，负为减少） |
| balance_after | INTEGER | 变动后余额 |
| remark | VARCHAR | 备注 |
| admin_id | INTEGER REFERENCES admins(id) NULL | 操作管理员（充值时） |
| created_at | TIMESTAMP | |

### cdks — 兑换码表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| code | VARCHAR UNIQUE NOT NULL | 兑换码 |
| points | INTEGER NOT NULL | 积分数量 |
| status | VARCHAR DEFAULT 'unused' | unused / used |
| user_id | INTEGER REFERENCES users(id) NULL | 使用者 |
| admin_id | INTEGER REFERENCES admins(id) | 创建者 |
| used_at | TIMESTAMP NULL | 使用时间 |
| created_at | TIMESTAMP | |

### checkins — 签到记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| user_id | INTEGER REFERENCES users(id) | |
| checkin_date | DATE NOT NULL | 签到日期 |
| points_earned | INTEGER | 获得积分 |
| created_at | TIMESTAMP | |

### settings — 系统配置表

| 字段 | 类型 | 说明 |
|------|------|------|
| key | VARCHAR PRIMARY KEY | 配置键 |
| value | TEXT | 配置值 |

预置配置项：
- `base_url` — 中转站地址
- `api_key` — API 密钥
- `default_model` — 默认模型（gpt-image-2）
- `points_per_generation` — 每次生图消耗积分
- `checkin_points` — 每日签到积分
- `checkin_consecutive_bonus` — 连续签到奖励 JSON，如 {"7": 5, "30": 20}

### admins — 管理员表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | |
| username | VARCHAR UNIQUE NOT NULL | |
| password_hash | VARCHAR NOT NULL | |
| created_at | TIMESTAMP | |

## API 设计

### 小程序端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 微信登录，返回 JWT |
| POST | /api/images/generate | 文生图 |
| POST | /api/images/edit | 图片编辑 |
| GET | /api/images/history?page=&pageSize= | 历史记录（分页） |
| GET | /api/images/:id | 单条记录详情 |
| DELETE | /api/images/:id | 删除记录 |
| GET | /api/user/profile | 用户信息 |
| GET | /api/user/points?page=&pageSize= | 积分变动记录 |
| POST | /api/user/cdk/redeem | 兑换 CDK |
| POST | /api/user/checkin | 每日签到 |
| GET | /api/user/checkin/status | 签到状态 |

**文生图请求体：**
```json
{
  "prompt": "一只漂浮在太空里的猫",
  "model": "gpt-image-2",
  "size": "1024x1024",
  "n": 1
}
```

**图片编辑请求体：** multipart/form-data，包含 prompt、model、size、n 和 image 文件字段。

### 管理后台端

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /admin/api/login | 管理员登录 |
| GET | /admin/api/users | 用户列表 |
| POST | /admin/api/users/:id/recharge | 充值积分 |
| GET | /admin/api/generations | 所有生成记录 |
| GET | /admin/api/settings | 获取配置 |
| PUT | /admin/api/settings | 更新配置 |
| POST | /admin/api/cdk/generate | 批量生成 CDK |
| GET | /admin/api/cdk/list?status=&page= | CDK 列表 |

## 支持的图片尺寸

| 尺寸 | 说明 |
|------|------|
| 1024x1024 | 正方形 |
| 1536x1024 | 横版 |
| 1024x1536 | 竖版 |
| 2048x2048 | 2K 正方形 |
| 3840x2160 | 4K 横版 |

## 小程序页面结构

### 首页 — 文生图
- 提示词输入框（多行文本）
- 尺寸选择：5 种尺寸以卡片形式展示，带尺寸图标示意
- 生成按钮，显示本次消耗积分数
- 生成中 loading 动画
- 生成完成后显示图片，可保存到相册

### 图片编辑页
- 上传图片区域
- 提示词输入框
- 尺寸选择（同文生图）
- 生成按钮
- 结果展示，可保存到相册

### 历史记录页
- 瀑布流展示所有生成记录
- 点击可查看大图、提示词、生成参数
- 可删除记录

### 个人中心
- 头像、昵称、剩余积分
- 每日签到按钮（已签到时置灰）
- 兑换码入口
- 积分变动记录入口

### 管理后台（浏览器页面）
- 用户管理：查看所有用户、积分余额，手动充值积分
- CDK 管理：批量生成 CDK，查看 CDK 列表和状态
- 生成记录：查看所有生成记录
- 系统设置：配置 baseUrl、apiKey、积分策略等

## UI 风格：Kawaii Minimal

### 视觉理念
在清晰布局和信息层级之上，点缀少量糖果色、笑脸和圆角。背景保持柔和的奶油白或淡粉渐变，画面明亮轻盈。主卡片与模块保留极简结构，只在关键区域使用高饱和糖果色渐变。整体给人「干净、甜但不过度甜腻」的印象。

### 色彩
- 背景：奶油白 (#FFF8F0) 或淡粉渐变
- 强调色：粉、紫、薄荷绿、奶油黄等糖果色
- 按钮和标签使用糖果色渐变
- 大面积区域保持低饱和浅色

### 材质与质感
- 大尺寸圆角卡片（贴纸感）
- 按钮像软糖或圆角胶囊
- 纯色或轻微渐变，不使用复杂纹理
- 图标简化形体 + 明亮配色，不追求写实
- 正文使用易读的系统无衬线字体

### 交互体验
- 悬停/点击时轻微上浮 + 弹跳，像小软糖被弹起
- 卡片 hover 时轻微提亮或 1-2px 位移
- 动效时长 200-300ms，缓动曲线 ease-out 或带回弹
- 负面状态（错误、删除）以柔和方式呈现

### 氛围
像干净的文具桌或贴满贴纸的笔记本封面：到处有小面积可爱元素，但画面中心留给内容本身。使用时感觉「心情变好、又能认真完成任务」。

## 后端核心流程

### 文生图流程
1. 用户提交 prompt、size、model
2. 后端校验积分是否足够
3. 创建 generation 记录（status: pending）
4. 请求 `{baseUrl}/v1/images/generations`，携带 apiKey
5. 收到 base64 图片数据后保存到本地磁盘
6. 扣减积分，记录 point_log
7. 更新 generation 记录（status: success, result_image_path）
8. 返回图片 URL 给小程序

### 图片编辑流程
与文生图类似，区别在于请求 `{baseUrl}/v1/images/edits`，通过 multipart/form-data 上传原图。

### 签到流程
1. 检查今日是否已签到
2. 计算连续签到天数（last_checkin_date 是否为昨天）
3. 发放基础积分 + 连续签到奖励（如有）
4. 更新用户 consecutive_checkins 和 last_checkin_date
5. 记录 checkin 和 point_log

### CDK 兑换流程
1. 用户输入 CDK code
2. 查询 cdks 表，校验状态为 unused
3. 更新 cdk 状态为 used，关联 user_id
4. 增加用户积分，记录 point_log

## 错误处理
- 积分不足：返回明确提示，引导用户兑换 CDK 或联系管理员
- 中转站调用失败：记录 error_message，不扣积分，提示用户稍后重试
- 图片生成超时：设置 120 秒超时，超时后标记为 failed
- CDK 无效或已使用：返回明确错误信息
