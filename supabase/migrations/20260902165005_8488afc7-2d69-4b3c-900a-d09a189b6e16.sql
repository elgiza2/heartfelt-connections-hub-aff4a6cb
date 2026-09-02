CREATE OR REPLACE FUNCTION public.referral_required_task_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT ARRAY['trustpilot_review','X','x_like_repost']::text[] $$;

REVOKE EXECUTE ON FUNCTION public.referral_required_task_keys() FROM anon;