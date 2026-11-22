-- BioLifeDrive schema — Postgres 17
-- Run automatically on server start (server.js), or manually:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS authors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  skin TEXT DEFAULT 'classic-blue',
  custom_skin_url TEXT,
  custom_skin_name TEXT,
  song_title TEXT,
  song_artist TEXT,
  song_url TEXT,
  bot_enabled BOOLEAN DEFAULT TRUE,
  bot_greeting TEXT DEFAULT 'Hi, I am this creator''s AI companion. Ask me about their life story.',
  bot_personality TEXT DEFAULT 'Warm, curious, and encouraging',
  bot_topics TEXT DEFAULT '',
  bot_tone TEXT DEFAULT 'Friendly',
  total_reads INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stories (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT DEFAULT 'Life story',
  audience TEXT DEFAULT 'all', -- all | adult
  status TEXT DEFAULT 'published', -- published | adult | blocked
  reads INT DEFAULT 0,
  likes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  story_id INT REFERENCES stories(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'published', -- published | adult | blocked
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  author_a INT REFERENCES authors(id) ON DELETE CASCADE,
  author_b INT REFERENCES authors(id) ON DELETE CASCADE,
  UNIQUE (author_a, author_b)
);

CREATE TABLE IF NOT EXISTS top_five (
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  friend_id INT REFERENCES authors(id) ON DELETE CASCADE,
  rank INT NOT NULL CHECK (rank BETWEEN 1 AND 5),
  PRIMARY KEY (author_id, rank)
);

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id INT REFERENCES authors(id) ON DELETE CASCADE,
  following_id INT REFERENCES authors(id) ON DELETE CASCADE,
  UNIQUE (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  story_id INT REFERENCES stories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  duration_minutes INT DEFAULT 0,
  views INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_path TEXT NOT NULL,
  duration_seconds INT DEFAULT 0,
  audience TEXT DEFAULT 'all', -- all | adult
  status TEXT DEFAULT 'published', -- published | adult | blocked
  views INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  plan TEXT DEFAULT 'free', -- free | creator
  price_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id INT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  blocker_id INT REFERENCES authors(id) ON DELETE CASCADE,
  blocked_id INT REFERENCES authors(id) ON DELETE CASCADE,
  UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS bot_messages (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user | assistant
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_skins (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  source_url TEXT,
  source_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
