-- Update reservation_nights RLS policy to be organization-based
DROP POLICY IF EXISTS "Users can view reservation nights for their listings" ON reservation_nights;

CREATE POLICY "Users can view reservation nights in their organizations"
ON reservation_nights
FOR SELECT
USING (
  listing_id IN (
    SELECT l.id
    FROM listings l
    JOIN guesty_accounts ga ON l.guesty_account_id = ga.id
    WHERE is_organization_member(ga.organization_id, auth.uid())
  )
);

-- Allow service role to insert/update/delete reservation_nights
ALTER TABLE reservation_nights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage reservation nights" ON reservation_nights;

CREATE POLICY "Service role can manage reservation nights"
ON reservation_nights
FOR ALL
USING (auth.jwt()->>'role' = 'service_role');