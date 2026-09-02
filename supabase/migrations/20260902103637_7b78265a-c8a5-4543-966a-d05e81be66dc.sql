-- Referral milestone Pro access is limited to 15 days and expires from the original grant time.
CREATE OR REPLACE FUNCTION public.grant_referral_milestone(_referrer uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  v_existing uuid;
  v_period_end timestamptz;
  v_sub_id text;
  v_granted_at timestamptz;
BEGIN
  IF _referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_referrer');
  END IF;

  SELECT count(DISTINCT referred_id)::int INTO v_count
  FROM public.referrals
  WHERE referrer_id = _referrer
    AND coalesce(status, 'confirmed') <> 'rejected';

  IF v_count < 5 THEN
    RETURN jsonb_build_object('ok', true, 'granted', false, 'referrals', v_count, 'needed', 5 - v_count);
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_milestone_grants WHERE user_id = _referrer AND milestone = 5) THEN
    UPDATE public.referral_codes SET referral_mode = 'revenue' WHERE user_id = _referrer;
    RETURN jsonb_build_object('ok', true, 'granted', false, 'reason', 'already_granted', 'referrals', v_count, 'revenue_share_percent', 20);
  END IF;

  v_period_end := now() + interval '15 days';
  v_sub_id := 'referral:milestone5:' || _referrer::text;

  INSERT INTO public.subscriptions
    (user_id, plan, status, current_period_end, polar_subscription_id, amount_cents, currency)
  VALUES
    (_referrer, 'pro', 'active', v_period_end, v_sub_id, 0, 'USD');

  INSERT INTO public.profiles (id, plan, updated_at)
  VALUES (_referrer, 'pro', now())
  ON CONFLICT (id) DO UPDATE SET plan = 'pro', updated_at = now();

  UPDATE public.referral_codes
     SET referral_mode = 'revenue'
   WHERE user_id = _referrer;

  INSERT INTO public.referral_milestone_grants (user_id, milestone, plan, expires_at)
  VALUES (_referrer, 5, 'pro', v_period_end)
  ON CONFLICT (user_id, milestone) DO NOTHING
  RETURNING granted_at INTO v_granted_at;

  RETURN jsonb_build_object('ok', true, 'granted', true, 'plan', 'pro',
                            'referrals', v_count, 'expires_at', v_period_end,
                            'duration_days', 15, 'revenue_share_percent', 20);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_referral_milestone(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_referral_milestone(uuid) TO service_role;

-- Keep the authenticated wrapper aligned with the 15-day reward contract.
CREATE OR REPLACE FUNCTION public.claim_referral_milestone()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_result := public.grant_referral_milestone(v_user);

  IF coalesce((v_result->>'granted')::boolean, false) OR v_result->>'reason' = 'already_granted' THEN
    UPDATE public.referral_codes
       SET referral_mode = 'revenue'
     WHERE user_id = v_user;
  END IF;

  RETURN v_result || jsonb_build_object('revenue_share_percent', 20, 'duration_days', 15);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral_milestone() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_referral_milestone() TO authenticated;

-- Any unexpired referral-only grants now end 15 days after their recorded creation.
UPDATE public.referral_milestone_grants
SET expires_at = granted_at + interval '15 days'
WHERE milestone = 5
  AND expires_at > now()
  AND granted_at + interval '15 days' < expires_at;

UPDATE public.subscriptions s
SET current_period_end = g.expires_at,
    updated_at = now()
FROM public.referral_milestone_grants g
WHERE g.user_id = s.user_id
  AND g.milestone = 5
  AND s.polar_subscription_id = 'referral:milestone5:' || s.user_id::text
  AND g.expires_at > now()
  AND s.current_period_end > g.expires_at;