CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  openid VARCHAR UNIQUE NOT NULL,
  nickname VARCHAR DEFAULT '',
  avatar_url VARCHAR DEFAULT '',
  points INTEGER DEFAULT 0,
  consecutive_checkins INTEGER DEFAULT 0,
  last_checkin_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS pc_accounts (
  id SERIAL PRIMARY KEY,
  username VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP DEFAULT NOW(),
  bound_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS web_login_sessions (
  token VARCHAR PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  base_url TEXT NOT NULL,
  api_prefix TEXT DEFAULT '/v1',
  api_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 100,
  timeout_ms INTEGER DEFAULT 120000,
  failure_threshold INTEGER DEFAULT 3,
  cooldown_seconds INTEGER DEFAULT 300,
  consecutive_failures INTEGER DEFAULT 0,
  circuit_status VARCHAR DEFAULT 'closed',
  circuit_open_until TIMESTAMP,
  last_error TEXT,
  last_success_at TIMESTAMP,
  last_failure_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE api_channels ADD COLUMN IF NOT EXISTS api_prefix TEXT DEFAULT '/v1';

CREATE TABLE IF NOT EXISTS generations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER REFERENCES api_channels(id) ON DELETE SET NULL,
  type VARCHAR NOT NULL,
  prompt TEXT NOT NULL,
  model VARCHAR NOT NULL DEFAULT 'gpt-image-2',
  size VARCHAR NOT NULL DEFAULT '1024x1024',
  source_image_path VARCHAR,
  result_image_path VARCHAR,
  thumbnail_image_path VARCHAR,
  points_cost INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE generations ADD COLUMN IF NOT EXISTS channel_id INTEGER;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS thumbnail_image_path VARCHAR;
CREATE INDEX IF NOT EXISTS idx_generations_user_created_at ON generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_user_status ON generations (user_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'generations_channel_id_fkey'
  ) THEN
    ALTER TABLE generations
      ADD CONSTRAINT generations_channel_id_fkey
      FOREIGN KEY (channel_id) REFERENCES api_channels(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS point_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  remark VARCHAR DEFAULT '',
  admin_id INTEGER REFERENCES admins(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cdks (
  id SERIAL PRIMARY KEY,
  code VARCHAR UNIQUE NOT NULL,
  points INTEGER NOT NULL,
  status VARCHAR DEFAULT 'unused',
  user_id INTEGER REFERENCES users(id),
  admin_id INTEGER REFERENCES admins(id) NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL,
  points_earned INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES
  ('default_model', 'gpt-image-2'),
  ('points_per_generation', '1'),
  ('points_cost_1k', '1'),
  ('points_cost_2k', '2'),
  ('points_cost_4k', '4'),
  ('invite_reward_points', '3'),
  ('checkin_points', '1'),
  ('checkin_consecutive_bonus', '{"7": 5, "30": 20}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS lottery_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT DEFAULT '',
  status VARCHAR DEFAULT 'active',
  starts_at TIMESTAMP DEFAULT NOW(),
  ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lottery_prizes (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  type VARCHAR NOT NULL DEFAULT 'points',
  points INTEGER DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  stock INTEGER,
  sort_order INTEGER DEFAULT 100,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lottery_chances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
  source VARCHAR NOT NULL,
  rule_key VARCHAR NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  remaining INTEGER NOT NULL DEFAULT 1,
  remark VARCHAR DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, campaign_id, rule_key)
);

CREATE TABLE IF NOT EXISTS lottery_draws (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
  chance_id INTEGER REFERENCES lottery_chances(id) ON DELETE SET NULL,
  prize_id INTEGER REFERENCES lottery_prizes(id) ON DELETE SET NULL,
  prize_name VARCHAR NOT NULL,
  prize_type VARCHAR NOT NULL,
  points INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lottery_chances_user_campaign ON lottery_chances (user_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_lottery_draws_user_created_at ON lottery_draws (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_prizes_campaign_name ON lottery_prizes (campaign_id, name);

INSERT INTO lottery_campaigns (id, name, description, status)
VALUES (1, '梦倩绘境灵感抽奖', '签到和邀请好友可领取抽奖机会，奖品自动发放到积分账户。', 'active')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('lottery_campaigns', 'id'), GREATEST((SELECT MAX(id) FROM lottery_campaigns), 1));

INSERT INTO lottery_prizes (campaign_id, name, type, points, weight, stock, sort_order, enabled) VALUES
  (1, '10 积分灵感包', 'points', 10, 5, NULL, 10, TRUE),
  (1, '5 积分补给', 'points', 5, 15, NULL, 20, TRUE),
  (1, '3 积分加油站', 'points', 3, 30, NULL, 30, TRUE),
  (1, '1 积分小确幸', 'points', 1, 45, NULL, 40, TRUE)
ON CONFLICT (campaign_id, name) DO NOTHING;

UPDATE lottery_prizes
SET enabled = FALSE
WHERE campaign_id = 1 AND name = '谢谢参与';
