
DROP POLICY IF EXISTS "tmp purge migrated read" ON storage.objects;
DROP POLICY IF EXISTS "tmp purge migrated delete" ON storage.objects;
DROP FUNCTION IF EXISTS public.tmp_is_migrated(text, text);
DROP FUNCTION IF EXISTS public.tmp_migrated_paths();
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM anon;
REVOKE SELECT ON public.telegram_media FROM anon;
