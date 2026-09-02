
CREATE OR REPLACE FUNCTION public.tmp_migrated_paths()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fallback_path FROM public.telegram_media WHERE fallback_path IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.tmp_migrated_paths() FROM public;
GRANT EXECUTE ON FUNCTION public.tmp_migrated_paths() TO anon, authenticated;
