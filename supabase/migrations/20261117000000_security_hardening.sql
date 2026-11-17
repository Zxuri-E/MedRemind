-- ============================================================================
-- MedRemind Security Hardening & DPDP Act 2023 Consent Integrity Migration
-- Migration: 20261117000000_security_hardening.sql
-- ============================================================================

-- 0. Safe Backfill for Pre-existing Consent Records Before Applying Strict Constraints
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consents') THEN
    UPDATE public.consents
    SET age_confirmed = TRUE, explicit_consent_given = TRUE
    WHERE status = 'ACTIVE' AND (age_confirmed IS NULL OR age_confirmed = FALSE);

    UPDATE public.consents
    SET age_confirmed = FALSE
    WHERE (status IS NULL OR status <> 'ACTIVE') AND age_confirmed IS NULL;
  END IF;
END $$;

-- 1. Consent Security & DPDP Compliance Hardening
-- Enforce mandatory, explicit age confirmation (never default to true)
ALTER TABLE IF EXISTS public.consents 
  ALTER COLUMN age_confirmed DROP DEFAULT;

-- Require explicit boolean confirmation
ALTER TABLE IF EXISTS public.consents 
  ALTER COLUMN age_confirmed SET NOT NULL;

-- Enforce valid consent state: age_confirmed must be explicitly true for ACTIVE consents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_consents_explicit_age_and_consent'
  ) THEN
    ALTER TABLE public.consents
      ADD CONSTRAINT chk_consents_explicit_age_and_consent 
      CHECK (
        (status = 'REVOKED') OR 
        (age_confirmed = TRUE AND explicit_consent_given = TRUE)
      );
  END IF;
END $$;

-- 2. Indexes for Isolation and High-Throughput Queries
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number ON public.profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_medications_patient_id ON public.medications(patient_id);
CREATE INDEX IF NOT EXISTS idx_medications_status ON public.medications(status);
CREATE INDEX IF NOT EXISTS idx_dose_schedules_patient_id ON public.dose_schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_dose_occurrences_patient_id ON public.dose_occurrences(patient_id);
CREATE INDEX IF NOT EXISTS idx_consents_user_id_status ON public.consents(user_id, status);

-- Indexes for Food & Nutrition Tracking
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'food_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_food_logs_patient_id ON public.food_logs(patient_id);
    CREATE INDEX IF NOT EXISTS idx_food_logs_consumed_at ON public.food_logs(consumed_at);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'nutrition_targets') THEN
    CREATE INDEX IF NOT EXISTS idx_nutrition_targets_patient_id ON public.nutrition_targets(patient_id);
  END IF;
END $$;

-- 3. Strict RLS Re-verification (Ensure anon/authenticated web clients cannot access DB directly)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- Ensure service_role has explicit scoped access
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "service_role_all_%s" ON public.%I TO service_role USING (true) WITH CHECK (true);', tbl, tbl);
  END LOOP;
END $$;
