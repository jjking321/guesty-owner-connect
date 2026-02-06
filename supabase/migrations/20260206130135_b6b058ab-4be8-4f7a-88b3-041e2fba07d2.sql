-- Add dispute pipeline columns to reviews table
ALTER TABLE public.reviews 
ADD COLUMN IF NOT EXISTS dispute_status text,
ADD COLUMN IF NOT EXISTS dispute_resolution text,
ADD COLUMN IF NOT EXISTS dispute_likelihood_score integer,
ADD COLUMN IF NOT EXISTS dispute_violation_category text,
ADD COLUMN IF NOT EXISTS dispute_case_file jsonb,
ADD COLUMN IF NOT EXISTS dispute_analyzed_at timestamptz,
ADD COLUMN IF NOT EXISTS dispute_is_high_priority boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS dispute_message_history jsonb,
ADD COLUMN IF NOT EXISTS dispute_conversation_summary text,
ADD COLUMN IF NOT EXISTS dispute_has_threats boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS dispute_has_pressure boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS dispute_has_refund_demands boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS dispute_submitted_at timestamptz,
ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz,
ADD COLUMN IF NOT EXISTS dispute_notes text;

-- Add check constraint for dispute_status
ALTER TABLE public.reviews 
ADD CONSTRAINT check_dispute_status 
CHECK (dispute_status IS NULL OR dispute_status IN ('triage', 'analyzing', 'not_eligible', 'submit_claim', 'submitted', 'pending', 'resolved'));

-- Add check constraint for dispute_resolution
ALTER TABLE public.reviews 
ADD CONSTRAINT check_dispute_resolution 
CHECK (dispute_resolution IS NULL OR dispute_resolution IN ('removed', 'denied'));

-- Add index for efficient querying by dispute_status
CREATE INDEX IF NOT EXISTS idx_reviews_dispute_status ON public.reviews(dispute_status) WHERE dispute_status IS NOT NULL;

-- Add composite index for filtering Airbnb reviews with low ratings
CREATE INDEX IF NOT EXISTS idx_reviews_airbnb_low_rating ON public.reviews(source, rating) WHERE source = 'airbnb' AND rating < 4;