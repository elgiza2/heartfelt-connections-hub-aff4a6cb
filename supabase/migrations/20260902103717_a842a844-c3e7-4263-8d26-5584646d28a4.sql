CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.expire_referral_pro_grants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expired integer := 0;
BEGIN
  WITH ended AS (
    UPDATE public.subscriptions s
       SET status = 'expired',
           updated_at = now()
     WHERE s.polar_subscription_id = 'referral:milestone5:' || s.user_id::text
       AND s.status = 'active'
       AND s.current_period_end IS NOT NULL
       AND s.current_period_end <= now()
    RETURNING s.user_id
  )
  UPDATE public.profiles p
     SET plan = 'free', updated_at = now()
    FROM ended e
   WHERE p.id = e.user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.subscriptions s2
        WHERE s2.user_id = e.user_id
          AND s2.status IN ('active', 'trialing')
          AND (s2.current_period_end IS NULL OR s2.current_period_end > now())
     );

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_referral_pro_grants() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_referral_pro_grants() TO service_role;

SELECT cron.unschedule('expire-referral-pro-grants')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-referral-pro-grants');

SELECT cron.schedule(
  'expire-referral-pro-grants',
  '7 * * * *',
  $$SELECT public.expire_referral_pro_grants();$$
);