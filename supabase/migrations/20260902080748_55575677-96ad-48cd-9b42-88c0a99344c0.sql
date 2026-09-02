-- 5 successful referrals => 30 days of free Pro, granted once per user.

CREATE TABLE IF NOT EXISTS public.referral_milestone_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  milestone integer NOT NULL DEFAULT 5,
  plan text NOT NULL DEFAULT 'pro',
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, milestone)
);

GRANT SELECT ON public.referral_milestone_grants TO authenticated;
GRANT ALL ON public.referral_milestone_grants TO service_role;

ALTER TABLE public.referral_milestone_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own milestone grants" ON public.referral_milestone_grants;
CREATE POLICY "own milestone grants"
  ON public.referral_milestone_grants FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.grant_referral_milestone(_referrer uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  v_existing uuid;
  v_period_end timestamptz := now() + interval '30 days';
  v_sub_id text;
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

  -- Once only.
  IF EXISTS (SELECT 1 FROM public.referral_milestone_grants WHERE user_id = _referrer AND milestone = 5) THEN
    RETURN jsonb_build_object('ok', true, 'granted', false, 'reason', 'already_granted', 'referrals', v_count);
  END IF;

  v_sub_id := 'referral:milestone5:' || _referrer::text;

  SELECT id INTO v_existing
  FROM public.subscriptions
  WHERE user_id = _referrer AND plan = 'pro' AND status = 'active'
    AND (current_period_end IS NULL OR current_period_end > now())
  ORDER BY current_period_end DESC NULLS LAST
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.subscriptions
       SET current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days',
           status = 'active',
           updated_at = now()
     WHERE id = v_existing
     RETURNING current_period_end INTO v_period_end;
  ELSE
    INSERT INTO public.subscriptions
      (user_id, plan, status, current_period_end, polar_subscription_id, amount_cents, currency)
    VALUES
      (_referrer, 'pro', 'active', v_period_end, v_sub_id, 0, 'USD');
  END IF;

  INSERT INTO public.profiles (id, plan, updated_at)
  VALUES (_referrer, 'pro', now())
  ON CONFLICT (id) DO UPDATE SET plan = 'pro', updated_at = now();

  INSERT INTO public.referral_milestone_grants (user_id, milestone, plan, expires_at)
  VALUES (_referrer, 5, 'pro', v_period_end)
  ON CONFLICT (user_id, milestone) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'granted', true, 'plan', 'pro',
                            'referrals', v_count, 'expires_at', v_period_end);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'detail', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_referral_milestone(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_referral_milestone(uuid) TO service_role;

-- Read-only status helper the UI can call for the signed-in user.
CREATE OR REPLACE FUNCTION public.my_referral_milestone()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count integer := 0;
  v_grant record;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT count(DISTINCT referred_id)::int INTO v_count
  FROM public.referrals
  WHERE referrer_id = v_user AND coalesce(status, 'confirmed') <> 'rejected';

  SELECT * INTO v_grant
  FROM public.referral_milestone_grants
  WHERE user_id = v_user AND milestone = 5;

  RETURN jsonb_build_object(
    'ok', true,
    'referrals', v_count,
    'target', 5,
    'remaining', greatest(0, 5 - v_count),
    'granted', v_grant.id IS NOT NULL,
    'plan', 'pro',
    'expires_at', v_grant.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_referral_milestone() TO authenticated;

-- Fire the milestone check whenever a referral row lands or is confirmed.
CREATE OR REPLACE FUNCTION public.referrals_milestone_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.grant_referral_milestone(NEW.referrer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referrals_milestone ON public.referrals;
CREATE TRIGGER trg_referrals_milestone
AFTER INSERT OR UPDATE OF status ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.referrals_milestone_trigger();