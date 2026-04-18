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
});
