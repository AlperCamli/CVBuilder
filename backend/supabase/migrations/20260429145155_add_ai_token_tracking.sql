-- Migration: add_ai_token_tracking
-- Description: Adds token usage columns to the ai_runs table for cost tracking.

ALTER TABLE "public"."ai_runs"
  ADD COLUMN IF NOT EXISTS "input_tokens" integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "output_tokens" integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "total_tokens" integer DEFAULT NULL;
