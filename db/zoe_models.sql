CREATE TABLE IF NOT EXISTS public.zoe_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zoe_models_enabled_order
  ON public.zoe_models (enabled, sort_order, display_name);

ALTER TABLE public.zoe_models ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.zoe_models TO authenticated;

DROP POLICY IF EXISTS "authenticated users can read enabled models" ON public.zoe_models;
CREATE POLICY "authenticated users can read enabled models"
  ON public.zoe_models FOR SELECT TO authenticated USING (enabled = TRUE);

INSERT INTO public.zoe_models
  (model_id, display_name, provider, description, tier, is_default, sort_order)
VALUES
  ('deepseek/deepseek-v4-flash', 'DeepSeek Flash', 'DeepSeek', 'Rápido y económico para tareas diarias.', 'free', TRUE, 10),
  ('deepseek/deepseek-v4-pro', 'DeepSeek Pro', 'DeepSeek', 'Mayor calidad para tareas complejas.', 'pro', FALSE, 20),
  ('anthropic/claude-sonnet-4-5', 'Claude Sonnet', 'Anthropic', 'Excelente para razonamiento y código.', 'pro', FALSE, 30),
  ('openai/gpt-4o', 'GPT-4o', 'OpenAI', 'Modelo general de alta capacidad.', 'pro', FALSE, 40),
  ('openai/gpt-4o-mini', 'GPT-4o Mini', 'OpenAI', 'Rápido para tareas pequeñas.', 'free', FALSE, 50),
  ('google/gemini-2.0-flash', 'Gemini Flash', 'Google', 'Rápido y eficiente para contexto amplio.', 'free', FALSE, 60),
  ('qwen/qwen-2.5-coder-32b-instruct', 'Qwen Coder', 'Qwen', 'Especializado en programación.', 'free', FALSE, 70)
ON CONFLICT (model_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  provider = EXCLUDED.provider,
  description = EXCLUDED.description,
  tier = EXCLUDED.tier,
  is_default = EXCLUDED.is_default,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.zoe_models_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zoe_models_updated_at ON public.zoe_models;
CREATE TRIGGER zoe_models_updated_at BEFORE UPDATE ON public.zoe_models
FOR EACH ROW EXECUTE FUNCTION public.zoe_models_updated_at();
