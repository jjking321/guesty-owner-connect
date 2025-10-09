-- Add a function to cancel sync jobs
CREATE OR REPLACE FUNCTION cancel_sync_job(job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE sync_jobs
  SET 
    status = 'failed',
    error_message = 'Cancelled by user',
    completed_at = now()
  WHERE id = job_id
    AND status = 'running';
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION cancel_sync_job(uuid) TO authenticated;