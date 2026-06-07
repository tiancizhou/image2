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

CREATE TABLE IF NOT EXISTS api_channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  base_url TEXT NOT NULL,
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
  points_cost INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE generations ADD COLUMN IF NOT EXISTS channel_id INTEGER;

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
  ('checkin_points', '1'),
  ('checkin_consecutive_bonus', '{"7": 5, "30": 20}')
ON CONFLICT (key) DO NOTHING;
