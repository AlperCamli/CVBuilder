import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (fileName: string): string => {
  const path = join(process.cwd(), "supabase", "migrations", fileName);
  return readFileSync(path, "utf-8");
};

describe("supabase migration schema assertions", () => {
  it("creates required phase 1 tables", () => {
    const migration = readMigration("20260417121000_phase1_tables.sql");

    expect(migration).toMatch(/create table if not exists public\.users/i);
    expect(migration).toMatch(/create table if not exists public\.subscriptions/i);
    expect(migration).toMatch(/create table if not exists public\.usage_counters/i);
    expect(migration).toMatch(/create table if not exists public\.cv_templates/i);
  });

  it("contains key constraints and indexes", () => {
    const migration = readMigration("20260417121000_phase1_tables.sql");

    expect(migration).toMatch(/unique \(user_id, period_month\)/i);
    expect(migration).toMatch(/where status in \('active', 'trialing'\)/i);
    expect(migration).toMatch(/users_locale_check/i);
    expect(migration).toMatch(/check \(storage_bytes_used >= 0\)/i);
  });

  it("enables RLS and self access policies", () => {
    const migration = readMigration("20260417121000_phase1_tables.sql");

    expect(migration).toMatch(/alter table public\.users enable row level security/i);
    expect(migration).toMatch(/create policy users_select_own/i);
    expect(migration).toMatch(/create policy subscriptions_select_own/i);
    expect(migration).toMatch(/create policy usage_counters_select_own/i);
  });

  it("includes shared updated_at trigger function", () => {
    const migration = readMigration("20260417120000_base_extensions.sql");

    expect(migration).toMatch(/create or replace function public\.set_updated_at/i);
  });

  it("creates required phase 2 CV domain tables", () => {
    const migration = readMigration("20260417133000_phase2_cv_domains.sql");

    expect(migration).toMatch(/create table if not exists public\.master_cvs/i);
    expect(migration).toMatch(/create table if not exists public\.tailored_cvs/i);
    expect(migration).toMatch(/create table if not exists public\.jobs/i);
    expect(migration).toMatch(/create table if not exists public\.files/i);
    expect(migration).toMatch(/create table if not exists public\.imports/i);
  });

  it("contains phase 2 lifecycle constraints and ownership policies", () => {
    const migration = readMigration("20260417133000_phase2_cv_domains.sql");

    expect(migration).toMatch(/master_cvs_source_type_check/i);
    expect(migration).toMatch(/imports_status_check/i);
    expect(migration).toMatch(/tailored_cvs_status_check/i);
    expect(migration).toMatch(/jobs_status_check/i);
    expect(migration).toMatch(/create policy master_cvs_select_own/i);
    expect(migration).toMatch(/create policy tailored_cvs_select_own/i);
    expect(migration).toMatch(/create policy imports_select_own/i);
    expect(migration).toMatch(/create policy jobs_select_own/i);
    expect(migration).toMatch(/create policy files_select_own/i);
  });

  it("creates required phase 3 AI and revision tables", () => {
    const migration = readMigration("20260418001000_phase3_ai_revisions.sql");

    expect(migration).toMatch(/create table if not exists public\.ai_runs/i);
    expect(migration).toMatch(/create table if not exists public\.ai_suggestions/i);
    expect(migration).toMatch(/create table if not exists public\.cv_block_revisions/i);
  });

  it("contains phase 3 flow and revision constraints with ownership policies", () => {
    const migration = readMigration("20260418001000_phase3_ai_revisions.sql");

    expect(migration).toMatch(/ai_runs_flow_type_check/i);
    expect(migration).toMatch(/ai_suggestions_action_type_check/i);
    expect(migration).toMatch(/cv_block_revisions_change_source_check/i);
    expect(migration).toMatch(/cv_block_revisions_cv_scope_check/i);
    expect(migration).toMatch(/create policy ai_runs_select_own/i);
    expect(migration).toMatch(/create policy ai_suggestions_select_own/i);
    expect(migration).toMatch(/create policy cv_block_revisions_select_own/i);
  });

  it("contains phase 4A job status alignment and tracker history table", () => {
    const migration = readMigration("20260418123000_phase4a_jobs_dashboard_rendering.sql");

    expect(migration).toMatch(/update public\.jobs[\s\S]*status = 'interview'/i);
    expect(migration).toMatch(/update public\.jobs[\s\S]*status = 'offer'/i);
    expect(migration).toMatch(/create table if not exists public\.job_status_history/i);
    expect(migration).toMatch(/job_status_history_to_status_check/i);
    expect(migration).toMatch(/create policy job_status_history_select_own/i);
    expect(migration).toMatch(/create policy job_status_history_insert_own/i);
  });

  it("contains phase 4B exports table with constraints, indexes, and ownership policies", () => {
    const migration = readMigration("20260418150000_phase4b_exports.sql");

    expect(migration).toMatch(/create table if not exists public\.exports/i);
    expect(migration).toMatch(/exports_format_check/i);
    expect(migration).toMatch(/exports_status_check/i);
    expect(migration).toMatch(/exports_lifecycle_check/i);
    expect(migration).toMatch(/exports_user_id_created_at_idx/i);
    expect(migration).toMatch(/exports_tailored_cv_id_created_at_idx/i);
    expect(migration).toMatch(/exports_status_created_at_idx/i);
    expect(migration).toMatch(/alter table public\.exports enable row level security/i);
    expect(migration).toMatch(/create policy exports_select_own/i);
    expect(migration).toMatch(/create policy exports_insert_own/i);
    expect(migration).toMatch(/create policy exports_update_own/i);
  });

  it("contains phase 4C billing linkage indexes and usage increment function", () => {
    const migration = readMigration("20260418170000_phase4c_billing_entitlements.sql");

    expect(migration).toMatch(/subscriptions_provider_customer_id_idx/i);
    expect(migration).toMatch(/subscriptions_provider_subscription_id_idx/i);
    expect(migration).toMatch(/create or replace function public\.increment_usage_counters/i);
    expect(migration).toMatch(/on conflict \(user_id, period_month\)/i);
    expect(migration).toMatch(/grant execute on function public\.increment_usage_counters/i);
  });

  it("contains phase 6A exports target scope updates for master CV support", () => {
    const migration = readMigration("20260430120000_phase6a_master_cv_exports.sql");

    expect(migration).toMatch(/add column if not exists master_cv_id/i);
    expect(migration).toMatch(/alter column tailored_cv_id drop not null/i);
    expect(migration).toMatch(/exports_target_scope_check/i);
    expect(migration).toMatch(/exports_master_cv_id_created_at_idx/i);
  });

  it("contains phase 5 AI prompt table and master/tailored suggestion scope updates", () => {
    const migration = readMigration("20260421130000_phase5_ai_gemini_prompts.sql");

    expect(migration).toMatch(/create table if not exists public\.ai_prompt_configs/i);
    expect(migration).toMatch(/ai_prompt_configs_flow_type_check/i);
    expect(migration).toMatch(/ai_prompt_configs_action_type_check/i);
    expect(migration).toMatch(/alter table public\.ai_suggestions[\s\S]*add column if not exists master_cv_id/i);
    expect(migration).toMatch(/ai_suggestions_target_scope_check/i);
    expect(migration).toMatch(/import_improve/i);
  });

  it("contains phase 6B cv_parse prompt hardening and template visibility upserts", () => {
    const migration = readMigration("20260502100000_phase6b_ai_parse_and_template_defaults.sql");

    expect(migration).toMatch(/where slug = 'modern-clean'/i);
    expect(migration).toMatch(/where slug = 'minimal-professional'/i);
    expect(migration).toMatch(/where slug = 'executive-timeline'/i);
    expect(migration).toMatch(/where slug = 'creative-portfolio'/i);
    expect(migration).toMatch(/flow_type = 'cv_parse'/i);
    expect(migration).toMatch(/provider in \('any', 'gemini'\)/i);
    expect(migration).toMatch(/model_name = null/i);
  });

  it("contains phase 6C cv_parse canonical contract prompt hardening", () => {
    const migration = readMigration("20260502120000_phase6c_cv_parse_prompt_canonical_contract.sql");

    expect(migration).toMatch(/flow_type = 'cv_parse'/i);
    expect(migration).toMatch(/provider in \('any', 'gemini'\)/i);
    expect(migration).toMatch(/canonical section types only/i);
    expect(migration).toMatch(/canonical metadata keys only/i);
    expect(migration).toMatch(/awards use issuer/i);
    expect(migration).toMatch(/non-proficiency bracket details to certificate/i);
  });
});
