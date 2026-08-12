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

-- Powers "what's my assignment today" (worker) and "who's at this site
-- this week" (admin) without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_assignments_user_dates ON assignments (user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_assignments_site_dates ON assignments (site_id, start_date, end_date);
