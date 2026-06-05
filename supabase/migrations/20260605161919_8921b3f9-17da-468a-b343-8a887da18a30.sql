
CREATE TABLE public.kpi_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kpi_saved_views_user_id_idx ON public.kpi_saved_views(user_id);
CREATE UNIQUE INDEX kpi_saved_views_user_name_idx ON public.kpi_saved_views(user_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_saved_views TO authenticated;
GRANT ALL ON public.kpi_saved_views TO service_role;

ALTER TABLE public.kpi_saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own KPI saved views"
  ON public.kpi_saved_views
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER kpi_saved_views_updated_at
  BEFORE UPDATE ON public.kpi_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
