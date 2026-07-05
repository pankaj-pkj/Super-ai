-- Super AI backend schema (MySQL / MariaDB — cPanel standard)
-- Import once via cPanel → phpMyAdmin → Import.

CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(190) UNIQUE NOT NULL,
  name         VARCHAR(120) NOT NULL,
  provider     VARCHAR(20)  DEFAULT 'email',   -- email | google
  picture      VARCHAR(400) DEFAULT NULL,
  verified     TINYINT      DEFAULT 0,
  created_at   INT          DEFAULT 0
);

-- The always-on knowledge base grown by the cron learner (server-side).
CREATE TABLE IF NOT EXISTS knowledge (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  source       VARCHAR(500) NOT NULL,
  source_type  VARCHAR(20)  DEFAULT 'web',     -- github | web | chat | manual
  title        VARCHAR(300) DEFAULT '',
  kind         VARCHAR(20)  DEFAULT 'text',    -- text | code
  lang         VARCHAR(30)  DEFAULT '',
  body         MEDIUMTEXT   NOT NULL,
  created_at   INT          DEFAULT 0,
  UNIQUE KEY uniq_source (source(190)),
  FULLTEXT KEY ft_body (title, body)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chats (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT          NOT NULL,
  session_id   VARCHAR(64)  DEFAULT 'default',
  model        VARCHAR(40)  NOT NULL,
  prompt       TEXT         NOT NULL,
  response     MEDIUMTEXT   NOT NULL,
  tokens       INT          DEFAULT 0,
  created_at   INT          DEFAULT 0,
  KEY k_user (user_id), KEY k_session (session_id)
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id      INT          NOT NULL,
  day          CHAR(10)     NOT NULL,          -- YYYY-MM-DD (UTC)
  used         INT          DEFAULT 0,
  requests     INT          DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Cache of realtime web scrapes so repeat questions are instant.
CREATE TABLE IF NOT EXISTS scrape_cache (
  url_hash     CHAR(40)     PRIMARY KEY,
  url          VARCHAR(700) NOT NULL,
  content      MEDIUMTEXT   NOT NULL,
  fetched_at   INT          DEFAULT 0
);

-- Queue of topics users asked that the KB didn't know — the learner resolves these.
CREATE TABLE IF NOT EXISTS curiosity (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  topic        VARCHAR(200) UNIQUE NOT NULL,
  resolved     TINYINT      DEFAULT 0,
  created_at   INT          DEFAULT 0
);
