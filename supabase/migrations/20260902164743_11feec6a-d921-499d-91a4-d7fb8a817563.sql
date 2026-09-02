CREATE UNIQUE INDEX IF NOT EXISTS user_reward_tasks_user_task_uniq
  ON public.user_reward_tasks (user_id, task_id);

CREATE OR REPLACE FUNCTION public.referral_required_task_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['trustpilot_review','X','x_like_repost']::text[] $$;

CREATE OR REPLACE FUNCTION public.complete_referral_task(p_task_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_task record;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT (p_task_key = ANY (public.referral_required_task_keys())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_not_allowed');
  END IF;

  SELECT * INTO v_task FROM public.reward_tasks WHERE task_key = p_task_key AND active = true;
  IF v_task.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'task_not_found');
  END IF;

  INSERT INTO public.user_reward_tasks (user_id, task_id, progress, completed_at, awarded_credits)
  VALUES (v_user, v_task.id, greatest(1, coalesce(v_task.target_count, 1)), now(), 0)
  ON CONFLICT (user_id, task_id) DO UPDATE
    SET completed_at = coalesce(public.user_reward_tasks.completed_at, now()),
        progress = greatest(public.user_reward_tasks.progress, greatest(1, coalesce(v_task.target_count, 1))),
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'task_key', p_task_key, 'completed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_referral_milestone()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count integer := 0;
  v_grant record;
  v_tasks jsonb := '[]'::jsonb;
  v_required integer := 0;
  v_done integer := 0;
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

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'key', t.task_key,
      'title', t.title,
      'description', t.description,
      'url', t.action_url,
      'icon', t.icon,
      'done', u.completed_at IS NOT NULL
    ) ORDER BY t.sort_order), '[]'::jsonb),
    count(*)::int,
    count(u.completed_at)::int
  INTO v_tasks, v_required, v_done
  FROM public.reward_tasks t
  LEFT JOIN public.user_reward_tasks u ON u.task_id = t.id AND u.user_id = v_user
  WHERE t.task_key = ANY (public.referral_required_task_keys()) AND t.active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'referrals', v_count,
    'target', 5,
    'remaining', greatest(0, 5 - v_count),
    'granted', v_grant.id IS NOT NULL,
    'plan', 'pro',
    'expires_at', v_grant.expires_at,
    'tasks', v_tasks,
    'tasks_total', v_required,
    'tasks_done', v_done,
    'tasks_complete', v_done >= v_required,
    'can_claim', v_count >= 5 AND v_done >= v_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_referral_milestone()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_result jsonb;
  v_required integer := 0;
  v_done integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT count(*)::int, count(u.completed_at)::int
    INTO v_required, v_done
  FROM public.reward_tasks t
  LEFT JOIN public.user_reward_tasks u ON u.task_id = t.id AND u.user_id = v_user
  WHERE t.task_key = ANY (public.referral_required_task_keys()) AND t.active = true;

  IF v_done < v_required THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'tasks_incomplete',
      'tasks_total', v_required,
      'tasks_done', v_done
    );
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

GRANT EXECUTE ON FUNCTION public.complete_referral_task(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_required_task_keys() TO authenticated, anon;