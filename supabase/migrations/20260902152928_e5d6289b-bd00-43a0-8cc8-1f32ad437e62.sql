CREATE OR REPLACE FUNCTION public.purge_system_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
  DELETE FROM net._http_response WHERE created < now() - interval '1 day';
END;
$$;

REVOKE ALL ON FUNCTION public.purge_system_logs() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('purge-system-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-system-logs');

SELECT cron.schedule('purge-system-logs', '17 3 * * *', $$SELECT public.purge_system_logs();$$);