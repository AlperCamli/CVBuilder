-- =============================================================================
-- User Acquisition & Activation Report
-- =============================================================================
-- Signups, acquisition source, onboarding completion, and activation
-- (first successful CV upload or CV creation), bucketed by signup-month cohort.
--
-- Tables: public.users, public.imports, public.master_cvs
--
-- ⚠️ ACQUISITION SOURCE CAVEAT
-- There is NO acquisition/UTM/referrer/channel column on public.users (or any
-- table). "Where they come from" cannot be answered from the current schema.
-- Until a source column is added (e.g. users.signup_source populated from a UTM
-- or the OAuth provider in auth.users.raw_app_meta_data), this report uses
-- `locale` as a stand-in dimension. Swap `acquisition_source` below for the real
-- column once it exists.
--
-- Activation definition:
--   * "CV creation"      -> a master_cv with source_type = 'scratch'
--   * "CV upload"        -> a master_cv with source_type = 'import'
--                           (an uploaded file parsed + converted into a master CV)
--   A user is "activated" the first time ANY non-deleted master_cv exists.
-- =============================================================================

with base_users as (
  select
    u.id                                   as user_id,
    u.created_at                           as signed_up_at,
    date_trunc('month', u.created_at)::date as signup_month,
    u.onboarding_completed,
    -- Stand-in for real acquisition channel. Replace with users.signup_source.
    coalesce(u.locale, 'unknown')          as acquisition_source
  from public.users u
),

-- First activating CV per user (covers both "upload" and "from scratch").
first_cv as (
  select
    mc.user_id,
    min(mc.created_at)                                          as first_cv_at,
    -- did their FIRST cv come from an upload/import or from scratch?
    (array_agg(mc.source_type order by mc.created_at))[1]       as first_cv_source_type,
    bool_or(mc.source_type = 'import')                          as ever_uploaded,
    bool_or(mc.source_type = 'scratch')                         as ever_created_scratch
  from public.master_cvs mc
  where mc.is_deleted = false
  group by mc.user_id
),

-- First successful import (an uploaded file that actually parsed / converted).
first_successful_import as (
  select
    i.user_id,
    min(i.created_at) as first_successful_import_at
  from public.imports i
  where i.status in ('parsed', 'reviewed', 'converted')
  group by i.user_id
)

select
  bu.signup_month,
  bu.acquisition_source,

  -- Acquisition
  count(*)                                                          as signups,

  -- Onboarding
  count(*) filter (where bu.onboarding_completed)                  as onboarded_users,
  round(
    count(*) filter (where bu.onboarding_completed)::numeric
    / nullif(count(*), 0), 3
  )                                                                 as onboarding_completion_rate,

  -- Activation (first master CV created or uploaded)
  count(fc.user_id)                                                 as activated_users,
  round(count(fc.user_id)::numeric / nullif(count(*), 0), 3)        as activation_rate,

  -- Activation breakdown by how the first CV was produced
  count(*) filter (where fc.first_cv_source_type = 'import')        as activated_via_upload,
  count(*) filter (where fc.first_cv_source_type = 'scratch')       as activated_via_scratch,

  -- Upload reach specifically (successfully parsed an uploaded file)
  count(fsi.user_id)                                                as users_with_successful_upload,

  -- Onboarded users who never reached activation (drop-off after onboarding)
  count(*) filter (where bu.onboarding_completed and fc.user_id is null)
                                                                    as onboarded_but_not_activated,

  -- Median time from signup to first CV (activation latency)
  round(
    percentile_cont(0.5) within group (
      order by extract(epoch from (fc.first_cv_at - bu.signed_up_at)) / 3600.0
    )::numeric, 1
  )                                                                 as median_hours_to_activation

from base_users bu
left join first_cv fc                on fc.user_id  = bu.user_id
left join first_successful_import fsi on fsi.user_id = bu.user_id
group by bu.signup_month, bu.acquisition_source
order by bu.signup_month desc, signups desc;
