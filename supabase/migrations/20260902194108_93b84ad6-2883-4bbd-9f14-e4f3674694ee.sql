
CREATE POLICY "tmp purge migrated read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.telegram_media t WHERE t.fallback_path = storage.objects.bucket_id || '/' || storage.objects.name));

CREATE POLICY "tmp purge migrated delete" ON storage.objects
FOR DELETE TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.telegram_media t WHERE t.fallback_path = storage.objects.bucket_id || '/' || storage.objects.name));

GRANT SELECT ON public.telegram_media TO anon;
