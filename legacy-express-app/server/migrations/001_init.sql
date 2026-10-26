-- White Swan staff app: initial schema.
-- Every business table carries venue_id so a second venue is a new row, not new code.

CREATE TABLE IF NOT EXISTS organisations (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venues (
  id                     serial PRIMARY KEY,
  organisation_id        int NOT NULL REFERENCES organisations(id),
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name                   text NOT NULL,
  timezone               text NOT NULL DEFAULT 'Europe/London',
  leave_year_start_month int  NOT NULL DEFAULT 1 CHECK (leave_year_start_month BETWEEN 1 AND 12),
  weekly_hours_limit     numeric(5,2) NOT NULL DEFAULT 48,
  vat_rate               numeric(5,2) NOT NULL DEFAULT 20,
  labour_on_ex_vat       boolean NOT NULL DEFAULT true,
  positions              text[] NOT NULL DEFAULT ARRAY['Bar','Kitchen','Front of house','Housekeeping'],
  sales_column_map       jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id              serial PRIMARY KEY,
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash   text,
  full_name       text NOT NULL,
  phone           text,
  is_active       boolean NOT NULL DEFAULT true,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id                 serial PRIMARY KEY,
  user_id            int NOT NULL REFERENCES users(id),
  venue_id           int NOT NULL REFERENCES venues(id),
  role               text NOT NULL CHECK (role IN ('owner','manager','supervisor','staff')),
  can_view_documents boolean NOT NULL DEFAULT false,
  position           text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  membership_id     int PRIMARY KEY REFERENCES memberships(id),
  holiday_type      text NOT NULL DEFAULT 'regular' CHECK (holiday_type IN ('regular','irregular')),
  days_per_week     numeric(3,1) NOT NULL DEFAULT 5 CHECK (days_per_week BETWEEN 0 AND 7),
  hours_per_day     numeric(4,2) NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  contracted_hours  numeric(5,2),
  start_date        date,
  leave_date        date,
  pay_rate          numeric(8,2)
);

CREATE TABLE IF NOT EXISTS invites (
  id          serial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  purpose     text NOT NULL CHECK (purpose IN ('invite','reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rota_weeks (
  id            serial PRIMARY KEY,
  venue_id      int NOT NULL REFERENCES venues(id),
  week_start    date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at  timestamptz,
  UNIQUE (venue_id, week_start)
);

CREATE TABLE IF NOT EXISTS shift_templates (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  name           text NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  break_minutes  int NOT NULL DEFAULT 0,
  position       text
);

CREATE TABLE IF NOT EXISTS shifts (
  id                   serial PRIMARY KEY,
  venue_id             int NOT NULL REFERENCES venues(id),
  membership_id        int REFERENCES memberships(id),   -- null = open shift
  shift_date           date NOT NULL,
  start_time           time NOT NULL,
  end_time             time NOT NULL,                     -- end <= start means it runs past midnight
  break_minutes        int NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
  position             text,
  notes                text,
  actual_start         time,
  actual_end           time,
  actual_break_minutes int,
  confirmed_at         timestamptz,
  confirmed_by         int REFERENCES memberships(id),
  edited_after_publish boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shifts_venue_date ON shifts(venue_id, shift_date);
CREATE INDEX IF NOT EXISTS shifts_member ON shifts(membership_id, shift_date);

CREATE TABLE IF NOT EXISTS unavailability (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  membership_id  int NOT NULL REFERENCES memberships(id),
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  weekday        int CHECK (weekday BETWEEN 1 AND 7),     -- set = repeating on that ISO weekday within the range
  note           text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS blackout_dates (
  id          serial PRIMARY KEY,
  venue_id    int NOT NULL REFERENCES venues(id),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  label       text NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id               serial PRIMARY KEY,
  venue_id         int NOT NULL REFERENCES venues(id),
  membership_id    int NOT NULL REFERENCES memberships(id),
  kind             text NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday','unpaid')),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  hours            numeric(6,2) NOT NULL CHECK (hours >= 0),
  note             text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','declined','withdrawn','expired','cancel_pending','cancelled')),
  decided_by       int REFERENCES memberships(id),
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS swap_requests (
  id                      serial PRIMARY KEY,
  venue_id                int NOT NULL REFERENCES venues(id),
  kind                    text NOT NULL CHECK (kind IN ('give','exchange')),
  from_membership_id      int NOT NULL REFERENCES memberships(id),
  to_membership_id        int NOT NULL REFERENCES memberships(id),
  from_shift_id           int NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  offered_shift_id        int REFERENCES shifts(id) ON DELETE SET NULL,
  note                    text,
  status                  text NOT NULL DEFAULT 'sent'
                          CHECK (status IN ('sent','declined_by_colleague','awaiting_manager','approved','declined','withdrawn','void')),
  colleague_responded_at  timestamptz,
  decided_by              int REFERENCES memberships(id),
  decided_at              timestamptz,
  decision_reason         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (from_membership_id <> to_membership_id)
);

CREATE TABLE IF NOT EXISTS shift_problems (
  id               serial PRIMARY KEY,
  venue_id         int NOT NULL REFERENCES venues(id),
  shift_id         int REFERENCES shifts(id) ON DELETE SET NULL,
  shift_snapshot   jsonb NOT NULL,          -- the exact shift as it was when raised
  raised_by        int NOT NULL REFERENCES memberships(id),
  type             text NOT NULL CHECK (type IN ('cant_make_it','wrong_times','wrong_role','other')),
  note             text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','declined','withdrawn')),
  resolution       text CHECK (resolution IN ('none','drop','edit')),
  decided_by       int REFERENCES memberships(id),
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problem_messages (
  id                    serial PRIMARY KEY,
  problem_id            int NOT NULL REFERENCES shift_problems(id),
  author_membership_id  int NOT NULL REFERENCES memberships(id),
  body                  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Holiday ledger: opening balances, carry-over and manual corrections. Never edited or deleted,
-- only corrected with new entries (holiday records must be kept for 6 years).
CREATE TABLE IF NOT EXISTS holiday_ledger (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  membership_id  int NOT NULL REFERENCES memberships(id),
  entry_date     date NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('opening','carry_over','adjustment')),
  hours          numeric(7,2) NOT NULL,
  note           text NOT NULL,
  created_by     int REFERENCES memberships(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION holiday_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'holiday_ledger is append-only; add a correcting entry instead'; END $$;
DROP TRIGGER IF EXISTS holiday_ledger_no_change ON holiday_ledger;
CREATE TRIGGER holiday_ledger_no_change BEFORE UPDATE OR DELETE ON holiday_ledger
  FOR EACH ROW EXECUTE FUNCTION holiday_ledger_immutable();

CREATE TABLE IF NOT EXISTS announcements (
  id                    serial PRIMARY KEY,
  venue_id              int NOT NULL REFERENCES venues(id),
  author_membership_id  int NOT NULL REFERENCES memberships(id),
  title                 text NOT NULL,
  body                  text NOT NULL,
  audience              text,              -- null = whole venue, else a position
  pinned                boolean NOT NULL DEFAULT false,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id  int NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  membership_id    int NOT NULL REFERENCES memberships(id),
  read_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, membership_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  membership_id  int NOT NULL REFERENCES memberships(id),
  kind           text NOT NULL,
  body           text NOT NULL,
  link           text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_member ON notifications(membership_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_uploads (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  file_name      text NOT NULL,
  column_map     jsonb NOT NULL,
  rows_imported  int NOT NULL,
  uploaded_by    int REFERENCES memberships(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_days (
  id            serial PRIMARY KEY,
  venue_id      int NOT NULL REFERENCES venues(id),
  sales_date    date NOT NULL,
  source        text NOT NULL CHECK (source IN ('typed','upload')),
  net_sales     numeric(10,2) NOT NULL CHECK (net_sales >= 0),
  includes_vat  boolean NOT NULL DEFAULT true,
  wet_sales     numeric(10,2),
  dry_sales     numeric(10,2),
  covers        int,
  upload_id     int REFERENCES sales_uploads(id),
  entered_by    int REFERENCES memberships(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, sales_date, source)
);

-- Right to work documents and payslips: the file itself lives encrypted in private storage,
-- never in a public folder. Rows hold only the reference.
CREATE TABLE IF NOT EXISTS rtw_documents (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  membership_id  int NOT NULL REFERENCES memberships(id),
  doc_type       text NOT NULL,
  check_date     date NOT NULL,
  check_method   text NOT NULL CHECK (check_method IN ('manual','online_share_code','idsp')),
  expiry_date    date,
  file_key       text NOT NULL,
  file_name      text NOT NULL,
  mime           text NOT NULL,
  size_bytes     int NOT NULL,
  sha256         text NOT NULL,
  replaced_by    int REFERENCES rtw_documents(id),
  uploaded_by    int REFERENCES memberships(id),
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payslips (
  id             serial PRIMARY KEY,
  venue_id       int NOT NULL REFERENCES venues(id),
  membership_id  int NOT NULL REFERENCES memberships(id),
  period_label   text NOT NULL,
  file_key       text NOT NULL,
  file_name      text NOT NULL,
  size_bytes     int NOT NULL,
  status         text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','released','viewed','withdrawn')),
  uploaded_by    int REFERENCES memberships(id),
  released_at    timestamptz,
  viewed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id            serial PRIMARY KEY,
  venue_id      int NOT NULL REFERENCES venues(id),
  title         text NOT NULL,
  description   text,
  event_date    date NOT NULL,
  start_time    time,
  end_time      time,
  is_published  boolean NOT NULL DEFAULT false,
  created_by    int REFERENCES memberships(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_public ON events(venue_id, event_date) WHERE is_published;

CREATE TABLE IF NOT EXISTS audit_log (
  id             bigserial PRIMARY KEY,
  venue_id       int REFERENCES venues(id),
  actor_user_id  int REFERENCES users(id),
  action         text NOT NULL,
  target_type    text,
  target_id      int,
  detail         jsonb,
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Real start/end of a shift as timestamps in the venue's time zone, so a shift across the
-- October clock change counts its true hours, and shifts past midnight work.
CREATE OR REPLACE FUNCTION shift_bounds(d date, s time, e time, tz text, OUT starts timestamptz, OUT ends timestamptz)
LANGUAGE sql IMMUTABLE AS $$
  SELECT (d + s) AT TIME ZONE tz,
         (d + e + CASE WHEN e <= s THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE tz
$$;

CREATE OR REPLACE FUNCTION shift_hours(d date, s time, e time, brk int, tz text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(0, round((extract(epoch FROM (b.ends - b.starts)) / 3600.0 - coalesce(brk,0) / 60.0)::numeric, 2))
  FROM shift_bounds(d, s, e, tz) b
$$;

-- One approval inbox across the three request types, as a view so states can't drift apart.
CREATE OR REPLACE VIEW approval_inbox AS
  SELECT 'time_off'::text AS kind, t.id, t.venue_id, t.membership_id AS raised_by, t.status, t.created_at,
         t.start_date AS first_date
    FROM time_off_requests t WHERE t.status IN ('pending','cancel_pending')
  UNION ALL
  SELECT 'swap', s.id, s.venue_id, s.from_membership_id, s.status, s.created_at, sh.shift_date
    FROM swap_requests s JOIN shifts sh ON sh.id = s.from_shift_id WHERE s.status = 'awaiting_manager'
  UNION ALL
  SELECT 'problem', p.id, p.venue_id, p.raised_by, p.status, p.created_at, (p.shift_snapshot->>'shift_date')::date
    FROM shift_problems p WHERE p.status = 'open';

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
