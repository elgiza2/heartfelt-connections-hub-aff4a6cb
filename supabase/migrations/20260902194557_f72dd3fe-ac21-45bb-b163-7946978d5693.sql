
CREATE OR REPLACE FUNCTION public.tmp_is_migrated(_bucket text, _name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.telegram_media WHERE fallback_path = _bucket || '/' || _name)
$$;
REVOKE EXECUTE ON FUNCTION public.tmp_is_migrated(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.tmp_is_migrated(text, text) TO anon, authenticated;

DROP POLICY IF EXISTS "tmp purge migrated read" ON storage.objects;
DROP POLICY IF EXISTS "tmp purge migrated delete" ON storage.objects;

CREATE POLICY "tmp purge migrated read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (public.tmp_is_migrated(bucket_id, name));

CREATE POLICY "tmp purge migrated delete" ON storage.objects
FOR DELETE TO anon, authenticated
USING (public.tmp_is_migrated(bucket_id, name));
