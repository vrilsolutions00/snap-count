-- The daily board view is automatically updatable. Keep it read-only for
-- anon and authenticated; score writes stay on the RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.leaderboard_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.leaderboard_daily TO anon, authenticated;
