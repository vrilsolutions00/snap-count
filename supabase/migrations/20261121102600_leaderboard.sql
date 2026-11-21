-- Snap Count leaderboard: private answers + sessions, public boards via RPCs/views.
-- SECURITY DEFINER functions live in the private schema. Public wrappers are
-- SECURITY INVOKER and only forward to those functions.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;
-- Anon may execute specific private functions (called from public wrappers)
-- but cannot see tables in this schema through the Data API.
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE TABLE private.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

INSERT INTO private.app_settings (key, value)
VALUES ('hash_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE private.daily_answers (
  puzzle_date date NOT NULL,
  tier text NOT NULL,
  answer_hash text NOT NULL,
  answer_hmac text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (puzzle_date, tier)
);

CREATE TABLE private.rate_limits (
  device_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, action, window_start)
);

CREATE TABLE private.banned_words (
  word text PRIMARY KEY
);

INSERT INTO private.banned_words (word) VALUES
  ('anal'),('anus'),('arse'),('asshole'),('ballsack'),('bastard'),('bitch'),
  ('blowjob'),('bollock'),('bollok'),('boner'),('boob'),('bugger'),('buttplug'),
  ('clitoris'),('cock'),('coon'),('crap'),('cunt'),('damn'),('dick'),('dildo'),
  ('dyke'),('fag'),('faggot'),('feck'),('fellate'),('fellatio'),('felching'),
  ('fuck'),('fudgepacker'),('flange'),('goddamn'),('homo'),('jerk'),('jizz'),
  ('kike'),('knobend'),('labia'),('muff'),('nigga'),('nigger'),('niglet'),
  ('penis'),('piss'),('poop'),('prick'),('pube'),('pussy'),('queer'),('retard'),
  ('rape'),('rapist'),('scrotum'),('sex'),('shit'),('sh1t'),('slut'),('smegma'),
  ('spunk'),('tit'),('tosser'),('turd'),('twat'),('vagina'),('wank'),('whore'),
  ('wtf'),('fck'),('fuk'),('fuq'),('sht'),('btch'),('azz'),('n1gger'),('fagot'),
  ('horny'),('orgasm'),('sperm'),('suckmydick'),('chink'),('spic'),('tranny'),
  ('fag1t'),('f4g'),('fcuk'),('phuck'),('shiit')
ON CONFLICT DO NOTHING;

CREATE TABLE public.sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  puzzle_date date NOT NULL,
  tier text NOT NULL DEFAULT 'starters',
  hard boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_device_day_tier_hard ON public.sessions (device_id, puzzle_date, tier, hard);

CREATE TABLE public.scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text NOT NULL,
  nickname_norm text NOT NULL,
  device_id uuid NOT NULL,
  puzzle_date date NOT NULL,
  tier text NOT NULL DEFAULT 'starters',
  hard boolean NOT NULL DEFAULT false,
  guesses int NOT NULL CHECK (guesses >= 1 AND guesses <= 11),
  solve_ms int NOT NULL CHECK (solve_ms >= 3000),
  won boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scores_nickname_day_tier_hard ON public.scores (nickname_norm, puzzle_date, tier, hard);
CREATE UNIQUE INDEX scores_device_day_tier_hard ON public.scores (device_id, puzzle_date, tier, hard);
CREATE INDEX scores_daily_rank ON public.scores (puzzle_date, tier, hard, won, guesses, solve_ms);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  join_code text NOT NULL UNIQUE,
  created_by_device uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, device_id)
);
CREATE INDEX group_members_device ON public.group_members (device_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sessions, public.scores, public.groups, public.group_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- Safe public view of official (non-hard) winning scores. No device_id.
-- View is security definer (default) so it can read scores; columns are non-sensitive.
CREATE OR REPLACE VIEW public.leaderboard_daily AS
SELECT nickname, guesses, solve_ms, puzzle_date, tier, created_at
FROM public.scores
WHERE won = true AND hard = false;

GRANT SELECT ON public.leaderboard_daily TO anon, authenticated;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION private.et_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_temp
AS $$
  SELECT (timezone('America/New_York', now()))::date;
$$;

CREATE OR REPLACE FUNCTION private.week_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  -- Monday of the ET calendar week containing p_date.
  SELECT p_date - ((EXTRACT(DOW FROM p_date)::int + 6) % 7);
$$;

CREATE OR REPLACE FUNCTION private.rate_ok(p_device uuid, p_action text, p_limit int, p_window interval)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
DECLARE
  w timestamptz;
  n int;
BEGIN
  IF p_device IS NULL THEN
    RETURN false;
  END IF;
  w := date_trunc('hour', now());
  IF p_window >= interval '1 day' THEN
    w := date_trunc('day', now());
  END IF;
  INSERT INTO private.rate_limits (device_id, action, window_start, count)
  VALUES (p_device, p_action, w, 1)
  ON CONFLICT (device_id, action, window_start)
  DO UPDATE SET count = private.rate_limits.count + 1
  RETURNING count INTO n;
  RETURN n <= p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION private.hash_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
  SELECT value FROM private.app_settings WHERE key = 'hash_secret';
$$;

CREATE OR REPLACE FUNCTION private.answer_hashes(p_date date, p_tier text, p_answer_id text, OUT answer_hash text, OUT answer_hmac text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, extensions, pg_temp
AS $$
DECLARE
  payload text := p_date::text || ':' || p_tier || ':' || p_answer_id;
  secret text;
BEGIN
  secret := private.hash_secret();
  answer_hash := encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex');
  answer_hmac := encode(extensions.hmac(convert_to(payload, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION private.normalize_nick(p_nick text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_nick, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION private.nickname_ok(p_nick text, OUT ok boolean, OUT reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
DECLARE
  trimmed text;
  compact text;
  w text;
  token text;
BEGIN
  trimmed := btrim(regexp_replace(coalesce(p_nick, ''), '\s+', ' ', 'g'));
  IF char_length(trimmed) < 2 OR char_length(trimmed) > 16 THEN
    ok := false; reason := 'nickname_length'; RETURN;
  END IF;
  IF trimmed !~ '^[A-Za-z0-9][A-Za-z0-9_ ]{0,14}[A-Za-z0-9]$' AND char_length(trimmed) > 1 THEN
    -- allow 2-char nicknames that are both alnum
    IF NOT (char_length(trimmed) = 2 AND trimmed ~ '^[A-Za-z0-9]{2}$') THEN
      ok := false; reason := 'nickname_chars'; RETURN;
    END IF;
  END IF;
  compact := regexp_replace(lower(trimmed), '[^a-z0-9]', '', 'g');
  FOR w IN SELECT word FROM private.banned_words LOOP
    IF length(w) >= 4 THEN
      IF position(w IN compact) > 0 THEN
        ok := false; reason := 'nickname_blocked'; RETURN;
      END IF;
    ELSE
      -- short words: token match only (avoid "class" containing "ass")
      FOREACH token IN ARRAY regexp_split_to_array(lower(trimmed), '[^a-z0-9]+') LOOP
        IF token = w THEN
          ok := false; reason := 'nickname_blocked'; RETURN;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  ok := true; reason := NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.group_devices(p_code text)
RETURNS TABLE (device_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.device_id
  FROM public.groups g
  JOIN public.group_members m ON m.group_id = g.id
  WHERE upper(g.join_code) = upper(p_code);
$$;

-- ---------- start_session ----------
CREATE OR REPLACE FUNCTION private.start_session(p_puzzle_date date, p_device_id uuid, p_tier text, p_hard boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  today date := private.et_today();
  rec public.sessions%ROWTYPE;
  t text;
BEGIN
  IF p_device_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_device');
  END IF;
  t := coalesce(nullif(p_tier, ''), 'starters');
  IF t NOT IN ('stars', 'starters', 'full') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_tier');
  END IF;
  IF p_puzzle_date IS NULL OR p_puzzle_date <> today THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_date');
  END IF;
  IF NOT private.rate_ok(p_device_id, 'start_session', 20, interval '1 hour') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT * INTO rec
  FROM public.sessions
  WHERE device_id = p_device_id
    AND puzzle_date = p_puzzle_date
    AND tier = t
    AND hard = coalesce(p_hard, false);

  IF rec.token IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'token', rec.token,
      'started_at', rec.started_at,
      'existing', true
    );
  END IF;

  INSERT INTO public.sessions (device_id, puzzle_date, tier, hard)
  VALUES (p_device_id, p_puzzle_date, t, coalesce(p_hard, false))
  RETURNING * INTO rec;

  RETURN jsonb_build_object(
    'ok', true,
    'token', rec.token,
    'started_at', rec.started_at,
    'existing', false
  );
END;
$$;

-- ---------- submit_score ----------
CREATE OR REPLACE FUNCTION private.submit_score(
  p_token uuid,
  p_nickname text,
  p_guesses int,
  p_answer_hash text,
  p_won boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions, pg_temp
AS $$
DECLARE
  sess public.sessions%ROWTYPE;
  today date := private.et_today();
  nick_ok boolean;
  nick_reason text;
  nick text;
  nick_n text;
  max_g int;
  solve int;
  expected text;
  new_row public.scores%ROWTYPE;
  official_hard boolean;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_token');
  END IF;

  SELECT * INTO sess FROM public.sessions WHERE token = p_token;
  IF sess.token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_token');
  END IF;
  IF sess.puzzle_date <> today THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_date');
  END IF;
  IF sess.used THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted');
  END IF;
  IF NOT private.rate_ok(sess.device_id, 'submit_score', 8, interval '1 hour') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT ns.ok, ns.reason INTO nick_ok, nick_reason FROM private.nickname_ok(p_nickname) AS ns;
  IF NOT nick_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', nick_reason);
  END IF;
  nick := btrim(regexp_replace(p_nickname, '\s+', ' ', 'g'));
  nick_n := private.normalize_nick(nick);

  official_hard := coalesce(sess.hard, false);
  max_g := CASE WHEN official_hard THEN 10 ELSE 8 END;
  IF p_guesses IS NULL OR p_guesses < 1 OR p_guesses > max_g THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_guesses');
  END IF;
  IF coalesce(p_won, true) = false AND p_guesses <> max_g THEN
    -- losses are recorded as max guesses; weekly will add +1
    NULL;
  END IF;

  solve := floor(EXTRACT(EPOCH FROM (now() - sess.started_at)) * 1000)::int;
  IF solve < 3000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_fast');
  END IF;

  SELECT da.answer_hash INTO expected
  FROM private.daily_answers da
  WHERE da.puzzle_date = sess.puzzle_date
    AND da.tier = CASE WHEN official_hard THEN 'hard' ELSE sess.tier END;

  IF expected IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_answer');
  END IF;
  IF p_answer_hash IS NULL OR lower(p_answer_hash) <> lower(expected) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_hash');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scores
    WHERE device_id = sess.device_id
      AND puzzle_date = sess.puzzle_date
      AND tier = sess.tier
      AND hard = official_hard
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_taken');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.scores
    WHERE nickname_norm = nick_n
      AND puzzle_date = sess.puzzle_date
      AND tier = sess.tier
      AND hard = official_hard
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nickname_taken');
  END IF;

  INSERT INTO public.scores (
    nickname, nickname_norm, device_id, puzzle_date, tier, hard, guesses, solve_ms, won
  ) VALUES (
    nick, nick_n, sess.device_id, sess.puzzle_date, sess.tier, official_hard,
    p_guesses, solve, coalesce(p_won, true)
  )
  RETURNING * INTO new_row;

  UPDATE public.sessions SET used = true WHERE token = sess.token;

  RETURN jsonb_build_object(
    'ok', true,
    'id', new_row.id,
    'nickname', new_row.nickname,
    'guesses', new_row.guesses,
    'solve_ms', new_row.solve_ms,
    'won', new_row.won,
    'puzzle_date', new_row.puzzle_date
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted');
END;
$$;

-- ---------- boards ----------
CREATE OR REPLACE FUNCTION private.get_daily_board(p_date date, p_tier text, p_group_code text, p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  d date := coalesce(p_date, private.et_today());
  t text := coalesce(nullif(p_tier, ''), 'starters');
  result jsonb;
BEGIN
  WITH members AS (
    SELECT device_id FROM private.group_devices(p_group_code)
    WHERE p_group_code IS NOT NULL AND length(p_group_code) > 0
  ),
  base AS (
    SELECT s.*
    FROM public.scores s
    WHERE s.puzzle_date = d
      AND s.tier = t
      AND s.hard = false
      AND s.won = true
      AND (
        p_group_code IS NULL OR length(p_group_code) = 0
        OR s.device_id IN (SELECT device_id FROM members)
      )
  ),
  ranked AS (
    SELECT
      row_number() OVER (ORDER BY guesses ASC, solve_ms ASC, created_at ASC) AS rank,
      nickname,
      guesses,
      solve_ms,
      device_id
    FROM base
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'nickname', nickname,
    'guesses', guesses,
    'solve_ms', solve_ms,
    'is_me', (p_device_id IS NOT NULL AND device_id = p_device_id)
  ) ORDER BY rank), '[]'::jsonb)
  INTO result
  FROM ranked;
  RETURN jsonb_build_object('ok', true, 'date', d, 'tier', t, 'rows', result);
END;
$$;

CREATE OR REPLACE FUNCTION private.get_weekly_board(p_date date, p_tier text, p_group_code text, p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  d date := coalesce(p_date, private.et_today());
  ws date;
  we date;
  t text := coalesce(nullif(p_tier, ''), 'starters');
  result jsonb;
  max_g int := 8;
BEGIN
  ws := private.week_start(d);
  we := ws + 6;
  WITH members AS (
    SELECT device_id FROM private.group_devices(p_group_code)
    WHERE p_group_code IS NOT NULL AND length(p_group_code) > 0
  ),
  base AS (
    SELECT s.*
    FROM public.scores s
    WHERE s.puzzle_date BETWEEN ws AND we
      AND s.tier = t
      AND s.hard = false
      AND (
        p_group_code IS NULL OR length(p_group_code) = 0
        OR s.device_id IN (SELECT device_id FROM members)
      )
  ),
  agg AS (
    SELECT
      device_id,
      (ARRAY_AGG(nickname ORDER BY puzzle_date DESC, created_at DESC))[1] AS nickname,
      count(*)::int AS days_played,
      sum(CASE WHEN won THEN guesses ELSE max_g + 1 END)::int AS total_guesses,
      sum(solve_ms)::bigint AS total_ms
    FROM base
    GROUP BY device_id
  ),
  ranked AS (
    SELECT
      row_number() OVER (ORDER BY days_played DESC, total_guesses ASC, total_ms ASC) AS rank,
      nickname, days_played, total_guesses, total_ms, device_id
    FROM agg
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'nickname', nickname,
    'days_played', days_played,
    'guesses', total_guesses,
    'solve_ms', total_ms,
    'is_me', (p_device_id IS NOT NULL AND device_id = p_device_id)
  ) ORDER BY rank), '[]'::jsonb)
  INTO result
  FROM ranked;
  RETURN jsonb_build_object('ok', true, 'week_start', ws, 'week_end', we, 'tier', t, 'rows', result);
END;
$$;

CREATE OR REPLACE FUNCTION private.get_streak_board(p_tier text, p_group_code text, p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  t text := coalesce(nullif(p_tier, ''), 'starters');
  today date := private.et_today();
  result jsonb;
BEGIN
  WITH members AS (
    SELECT device_id FROM private.group_devices(p_group_code)
    WHERE p_group_code IS NOT NULL AND length(p_group_code) > 0
  ),
  wins AS (
    SELECT s.device_id, s.puzzle_date,
           (ARRAY_AGG(s.nickname ORDER BY s.created_at DESC))[1] AS nickname
    FROM public.scores s
    WHERE s.tier = t AND s.hard = false AND s.won = true
      AND (
        p_group_code IS NULL OR length(p_group_code) = 0
        OR s.device_id IN (SELECT device_id FROM members)
      )
    GROUP BY s.device_id, s.puzzle_date
  ),
  numbered AS (
    SELECT
      device_id,
      puzzle_date,
      nickname,
      puzzle_date - (row_number() OVER (PARTITION BY device_id ORDER BY puzzle_date))::int AS grp
    FROM wins
  ),
  streaks AS (
    SELECT device_id, min(nickname) AS nickname, count(*)::int AS len,
           min(puzzle_date) AS start_date, max(puzzle_date) AS end_date
    FROM numbered
    GROUP BY device_id, grp
  ),
  best AS (
    SELECT device_id, max(len) AS best_streak
    FROM streaks
    GROUP BY device_id
  ),
  current AS (
    SELECT s.device_id, s.len AS current_streak, s.nickname
    FROM streaks s
    WHERE s.end_date = today OR s.end_date = today - 1
  ),
  latest_nick AS (
    SELECT DISTINCT ON (device_id) device_id, nickname
    FROM wins
    ORDER BY device_id, puzzle_date DESC
  ),
  ranked AS (
    SELECT
      row_number() OVER (ORDER BY b.best_streak DESC, coalesce(c.current_streak, 0) DESC) AS rank,
      n.nickname,
      b.best_streak,
      coalesce(c.current_streak, 0) AS current_streak,
      b.device_id
    FROM best b
    JOIN latest_nick n ON n.device_id = b.device_id
    LEFT JOIN current c ON c.device_id = b.device_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'nickname', nickname,
    'best_streak', best_streak,
    'current_streak', current_streak,
    'is_me', (p_device_id IS NOT NULL AND device_id = p_device_id)
  ) ORDER BY rank), '[]'::jsonb)
  INTO result
  FROM ranked;
  RETURN jsonb_build_object('ok', true, 'tier', t, 'rows', result);
END;
$$;

-- ---------- groups ----------
CREATE OR REPLACE FUNCTION private.new_join_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
BEGIN
  FOR i IN 1..20 LOOP
    code := '';
    WHILE length(code) < 6 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.groups WHERE join_code = code) THEN
      RETURN code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'could not allocate join code';
END;
$$;

CREATE OR REPLACE FUNCTION private.create_group(p_device_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  nm text;
  code text;
  gid uuid;
  nick_ok boolean;
  nick_reason text;
BEGIN
  IF p_device_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_device');
  END IF;
  IF NOT private.rate_ok(p_device_id, 'create_group', 5, interval '1 day') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  nm := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  IF char_length(nm) < 2 OR char_length(nm) > 24 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_length');
  END IF;
  SELECT ns.ok, ns.reason INTO nick_ok, nick_reason FROM private.nickname_ok(left(nm, 16)) AS ns;
  -- reuse nickname filter for short names; if the name is 17-24, check first 16 + compact
  IF NOT nick_ok AND nick_reason = 'nickname_blocked' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_blocked');
  END IF;
  IF nm !~ '^[A-Za-z0-9][A-Za-z0-9_ ]{0,22}[A-Za-z0-9]$' AND char_length(nm) <> 2 THEN
    IF NOT (char_length(nm) = 2 AND nm ~ '^[A-Za-z0-9]{2}$') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'name_chars');
    END IF;
  END IF;
  code := private.new_join_code();
  INSERT INTO public.groups (name, join_code, created_by_device)
  VALUES (nm, code, p_device_id)
  RETURNING id INTO gid;
  INSERT INTO public.group_members (group_id, device_id) VALUES (gid, p_device_id);
  RETURN jsonb_build_object('ok', true, 'id', gid, 'name', nm, 'join_code', code);
END;
$$;

CREATE OR REPLACE FUNCTION private.join_group(p_device_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, pg_temp
AS $$
DECLARE
  rec public.groups%ROWTYPE;
  code text;
BEGIN
  IF p_device_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_device');
  END IF;
  IF NOT private.rate_ok(p_device_id, 'join_group', 15, interval '1 hour') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(code) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_code');
  END IF;
  SELECT * INTO rec FROM public.groups WHERE join_code = code;
  IF rec.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  INSERT INTO public.group_members (group_id, device_id)
  VALUES (rec.id, p_device_id)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'id', rec.id, 'name', rec.name, 'join_code', rec.join_code);
END;
$$;

CREATE OR REPLACE FUNCTION private.list_groups(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_device_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_device');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'join_code', g.join_code,
    'mine', (g.created_by_device = p_device_id)
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO result
  FROM public.groups g
  JOIN public.group_members m ON m.group_id = g.id
  WHERE m.device_id = p_device_id;
  RETURN jsonb_build_object('ok', true, 'groups', result);
END;
$$;

-- service-role only seed hook
CREATE OR REPLACE FUNCTION private.upsert_daily_answer(p_date date, p_tier text, p_answer_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, extensions, pg_temp
AS $$
DECLARE
  h text;
  m text;
BEGIN
  IF p_date IS NULL OR p_tier IS NULL OR p_answer_id IS NULL OR p_answer_id = '' THEN
    RETURN;
  END IF;
  SELECT x.answer_hash, x.answer_hmac INTO h, m
  FROM private.answer_hashes(p_date, p_tier, p_answer_id) AS x;
  INSERT INTO private.daily_answers (puzzle_date, tier, answer_hash, answer_hmac)
  VALUES (p_date, p_tier, h, m)
  ON CONFLICT (puzzle_date, tier)
  DO UPDATE SET answer_hash = EXCLUDED.answer_hash, answer_hmac = EXCLUDED.answer_hmac;
END;
$$;

-- ---------- public wrappers (invoker) ----------
CREATE OR REPLACE FUNCTION public.start_session(p_puzzle_date date, p_device_id uuid, p_tier text DEFAULT 'starters', p_hard boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.start_session(p_puzzle_date, p_device_id, p_tier, p_hard);
$$;

CREATE OR REPLACE FUNCTION public.submit_score(p_token uuid, p_nickname text, p_guesses int, p_answer_hash text, p_won boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.submit_score(p_token, p_nickname, p_guesses, p_answer_hash, p_won);
$$;

CREATE OR REPLACE FUNCTION public.get_daily_board(p_date date DEFAULT NULL, p_tier text DEFAULT 'starters', p_group_code text DEFAULT NULL, p_device_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.get_daily_board(p_date, p_tier, p_group_code, p_device_id);
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_board(p_date date DEFAULT NULL, p_tier text DEFAULT 'starters', p_group_code text DEFAULT NULL, p_device_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.get_weekly_board(p_date, p_tier, p_group_code, p_device_id);
$$;

CREATE OR REPLACE FUNCTION public.get_streak_board(p_tier text DEFAULT 'starters', p_group_code text DEFAULT NULL, p_device_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.get_streak_board(p_tier, p_group_code, p_device_id);
$$;

CREATE OR REPLACE FUNCTION public.create_group(p_device_id uuid, p_name text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.create_group(p_device_id, p_name);
$$;

CREATE OR REPLACE FUNCTION public.join_group(p_device_id uuid, p_code text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.join_group(p_device_id, p_code);
$$;

CREATE OR REPLACE FUNCTION public.list_groups(p_device_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.list_groups(p_device_id);
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_daily_answer(p_date date, p_tier text, p_answer_id text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = private, public, pg_temp
AS $$
  SELECT private.upsert_daily_answer(p_date, p_tier, p_answer_id);
$$;

GRANT EXECUTE ON FUNCTION public.start_session(date, uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_score(uuid, text, int, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_board(date, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_board(date, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_streak_board(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_group(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_groups(uuid) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION private.start_session(date, uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.submit_score(uuid, text, int, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_daily_board(date, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_weekly_board(date, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_streak_board(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.create_group(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.join_group(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.list_groups(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.et_today() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.week_start(date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.rate_ok(uuid, text, int, interval) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.hash_secret() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.answer_hashes(date, text, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.normalize_nick(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.nickname_ok(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.group_devices(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.new_join_code() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.upsert_daily_answer(date, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_upsert_daily_answer(date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_daily_answer(date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.upsert_daily_answer(date, text, text) TO service_role;

-- Never grant table privileges on private or write privileges on public tables to anon.
