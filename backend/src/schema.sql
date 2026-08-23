CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  username           TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  full_name          TEXT NOT NULL,
  phone              TEXT,
  role               TEXT NOT NULL CHECK (role IN ('admin', 'employee')) DEFAULT 'employee',
  device_id          TEXT,
  pending_device_id  TEXT,
  device_bound_at    TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT true,
  token_version      INTEGER NOT NULL DEFAULT 0,
  locale             TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  radius_meters INTEGER NOT NULL DEFAULT 200,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  site_id          INTEGER NOT NULL REFERENCES sites(id),
  type             TEXT NOT NULL CHECK (type IN ('check_in', 'check_out')) DEFAULT 'check_in',
  client_event_id  UUID NOT NULL,
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  accuracy_meters  DOUBLE PRECISION,
  distance_meters  DOUBLE PRECISION NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('inside', 'outside')),
  device_id        TEXT NOT NULL,
  device_matched   BOOLEAN NOT NULL,
  is_mock_location BOOLEAN NOT NULL DEFAULT false,
  is_off_hours     BOOLEAN NOT NULL DEFAULT false,
  flagged          BOOLEAN NOT NULL DEFAULT false,
  flag_reason      TEXT,
  reviewed         BOOLEAN NOT NULL DEFAULT false,
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkins_user_client_event
  ON checkins (user_id, client_event_id);
CREATE INDEX IF NOT EXISTS idx_checkins_user_time ON checkins (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_user_type_time ON checkins (user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_flagged ON checkins (flagged) WHERE flagged = true;

-- One row = one worker assigned to one site for a date range, with an
-- optional task description. A "team" for a given day is just every
-- assignment that shares the same site_id + overlapping dates - no
-- separate teams table needed for that.
CREATE TABLE IF NOT EXISTS assignments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  site_id      INTEGER NOT NULL REFERENCES sites(id),
  task         TEXT,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  assigned_by  INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_assignments_user_dates ON assignments (user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_assignments_site_dates ON assignments (site_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS skills (
  id    SERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_skills (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id  INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level     INTEGER NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  notes     TEXT,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS site_skill_requirements (
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  skill_id        INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workers_needed  INTEGER NOT NULL DEFAULT 1 CHECK (workers_needed >= 1),
  PRIMARY KEY (site_id, skill_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id     INTEGER REFERENCES sites(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS surveys (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_answers (
  id          SERIAL PRIMARY KEY,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'info',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs (user_id, created_at DESC);
