-- Recreate public.leaderboard_daily as a security_invoker view so it
-- cannot bypass RLS, plus a narrow SELECT policy and column grants.
-- Writes still go only through SECURITY DEFINER RPCs.

DROP VIEW IF EXISTS public.leaderboard_daily;

GRANT SELECT (nickname, guesses, solve_ms, puzzle_date, tier, hard, won, created_at)
  ON public.scores TO anon, authenticated;

CREATE POLICY scores_select_public
  ON public.scores
  FOR SELECT
  TO anon, authenticated
  USING (won = true AND hard = false);

CREATE VIEW public.leaderboard_daily
  WITH (security_invoker = true)
  AS
  SELECT nickname, guesses, solve_ms, puzzle_date, tier, created_at
  FROM public.scores
  WHERE won = true AND hard = false;

GRANT SELECT ON public.leaderboard_daily TO anon, authenticated;
