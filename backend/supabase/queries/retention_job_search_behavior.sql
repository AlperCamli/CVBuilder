-- =============================================================================
-- Retention & Job Search Behavior Report
-- =============================================================================
-- How often users return, how many tailored CVs they create over time, whether
-- they come back for new job applications, and which early behaviours predict
-- long-term retention.
--
-- Tables: public.users, public.ai_runs, public.exports, public.tailored_cvs,
--         public.jobs, public.cv_block_revisions, public.imports
--
-- "Activity" = any of: an AI run, an export, a tailored CV created, a job added,
-- a block revision, or an import. The activity union below is the shared notion
-- of "the user did something" and is redefined per query (CTEs can't span
-- statements).
--
-- This file has FOUR independent queries:
--   QUERY A — weekly cohort retention triangle
--   QUERY B — tailored CVs created over time
--   QUERY C — returning for new job applications
--   QUERY D — early behaviours that predict long-term retention
-- =============================================================================


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY A — weekly cohort retention triangle                                 │
-- └───────────────────────────────────────────────────────────────────────────┘
-- Rows = signup week. Columns (week_offset) = weeks since signup. Cells = how
-- many of that cohort were active that many weeks later.
with activity as (
  select user_id, started_at as ts from public.ai_runs
  union all select user_id, created_at from public.exports
  union all select user_id, created_at from public.tailored_cvs where is_deleted = false
  union all select user_id, created_at from public.jobs
  union all select user_id, created_at from public.cv_block_revisions
  union all select user_id, created_at from public.imports
),
cohorts as (
  select id as user_id, date_trunc('week', created_at) as cohort_week, created_at as signed_up_at
  from public.users
),
active_offsets as (
  select
    c.cohort_week,
    c.user_id,
    floor(extract(epoch from (a.ts - c.signed_up_at)) / (7 * 86400))::int as week_offset
  from cohorts c
  join activity a on a.user_id = c.user_id
  where a.ts >= c.signed_up_at
)
select
  c.cohort_week,
  count(distinct c.user_id)                                                   as cohort_size,
  count(distinct ao.user_id) filter (where ao.week_offset = 0)                as wk0,
  count(distinct ao.user_id) filter (where ao.week_offset = 1)                as wk1,
  count(distinct ao.user_id) filter (where ao.week_offset = 2)                as wk2,
  count(distinct ao.user_id) filter (where ao.week_offset = 3)                as wk3,
  count(distinct ao.user_id) filter (where ao.week_offset = 4)                as wk4,
  count(distinct ao.user_id) filter (where ao.week_offset between 5 and 8)    as wk5_8,
  -- headline: week-1 and week-4 retention as a % of cohort
  round(count(distinct ao.user_id) filter (where ao.week_offset = 1)::numeric
        / nullif(count(distinct c.user_id), 0), 3)                            as wk1_retention,
  round(count(distinct ao.user_id) filter (where ao.week_offset = 4)::numeric
        / nullif(count(distinct c.user_id), 0), 3)                            as wk4_retention
from cohorts c
left join active_offsets ao on ao.user_id = c.user_id
group by c.cohort_week
order by c.cohort_week desc;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY B — tailored CVs created over time                                   │
-- └───────────────────────────────────────────────────────────────────────────┘
select
  date_trunc('month', created_at)::date            as month,
  count(*)                                          as tailored_cvs_created,
  count(distinct user_id)                           as creators,
  round(count(*)::numeric / nullif(count(distinct user_id), 0), 2)
                                                    as avg_per_creator,
  -- cumulative tailored CVs to date (growth curve)
  sum(count(*)) over (order by date_trunc('month', created_at)) as cumulative_tailored_cvs
from public.tailored_cvs
where is_deleted = false
group by date_trunc('month', created_at)
order by month desc;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY C — returning for new job applications                               │
-- └───────────────────────────────────────────────────────────────────────────┘
-- Do users come back to apply to NEW jobs over time, or use the product once?
-- Measures active job-adding weeks per user and the gap between first & last job.
with job_weeks as (
  select
    user_id,
    count(*)                                                  as jobs_added,
    count(distinct date_trunc('week', created_at))            as active_job_weeks,
    min(created_at)                                           as first_job_at,
    max(created_at)                                           as last_job_at,
    extract(epoch from (max(created_at) - min(created_at))) / 86400.0 as days_span
  from public.jobs
  group by user_id
)
select
  count(*)                                                          as users_who_added_jobs,
  count(*) filter (where jobs_added >= 2)                          as users_with_2plus_jobs,
  round(count(*) filter (where jobs_added >= 2)::numeric
        / nullif(count(*), 0), 3)                                  as repeat_applicant_rate,
  count(*) filter (where active_job_weeks >= 2)                    as users_returning_in_new_week,
  round(count(*) filter (where active_job_weeks >= 2)::numeric
        / nullif(count(*), 0), 3)                                  as return_for_new_application_rate,
  round(avg(jobs_added)::numeric, 2)                               as avg_jobs_per_user,
  round(percentile_cont(0.5) within group (order by jobs_added)::numeric, 1) as median_jobs_per_user,
  round(avg(days_span) filter (where jobs_added >= 2)::numeric, 1) as avg_days_span_repeat_users
from job_weeks;


-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ QUERY D — early behaviours that predict long-term retention                │
-- └───────────────────────────────────────────────────────────────────────────┘
-- "Long-term retained" = active at least 28 days after signup (any activity in
-- the day 28+ window). Compares retention rate across early (first-7-day)
-- behaviour buckets to surface which first-week actions correlate with sticking.
with activity as (
  select user_id, started_at as ts from public.ai_runs
  union all select user_id, created_at from public.exports
  union all select user_id, created_at from public.tailored_cvs where is_deleted = false
  union all select user_id, created_at from public.jobs
  union all select user_id, created_at from public.cv_block_revisions
  union all select user_id, created_at from public.imports
),
u as (
  select id as user_id, created_at as signed_up_at, onboarding_completed
  from public.users
  -- only users old enough to have had a chance to retain
  where created_at <= now() - interval '28 days'
),
features as (
  select
    u.user_id,
    u.onboarding_completed,
    -- specific early (first-week) milestones
    bool_or(exists (select 1 from public.tailored_cvs t
                    where t.user_id = u.user_id and t.is_deleted = false
                      and t.created_at < u.signed_up_at + interval '7 days'))                  as made_tailored_wk1,
    bool_or(exists (select 1 from public.exports e
                    where e.user_id = u.user_id and e.status = 'completed'
                      and e.created_at < u.signed_up_at + interval '7 days'))                  as downloaded_wk1,
    bool_or(exists (select 1 from public.jobs j
                    where j.user_id = u.user_id
                      and j.created_at < u.signed_up_at + interval '7 days'))                  as added_job_wk1,
    -- retained: any activity 28+ days after signup
    bool_or(a.ts >= u.signed_up_at + interval '28 days')                                       as retained
  from u
  left join activity a on a.user_id = u.user_id and a.ts >= u.signed_up_at
  group by u.user_id, u.onboarding_completed
)
select
  predictor,
  users_with_behavior,
  round(retained_with::numeric / nullif(users_with_behavior, 0), 3)   as retention_if_did,
  users_without_behavior,
  round(retained_without::numeric / nullif(users_without_behavior, 0), 3) as retention_if_didnt,
  round(retained_with::numeric / nullif(users_with_behavior, 0), 3)
    - round(retained_without::numeric / nullif(users_without_behavior, 0), 3) as lift
from (
  select 'completed_onboarding' as predictor,
         count(*) filter (where onboarding_completed)                              as users_with_behavior,
         count(*) filter (where onboarding_completed and retained)                 as retained_with,
         count(*) filter (where not onboarding_completed)                          as users_without_behavior,
         count(*) filter (where not onboarding_completed and retained)             as retained_without
  from features
  union all
  select 'made_tailored_cv_wk1',
         count(*) filter (where made_tailored_wk1),
         count(*) filter (where made_tailored_wk1 and retained),
         count(*) filter (where not made_tailored_wk1),
         count(*) filter (where not made_tailored_wk1 and retained)
  from features
  union all
  select 'downloaded_wk1',
         count(*) filter (where downloaded_wk1),
         count(*) filter (where downloaded_wk1 and retained),
         count(*) filter (where not downloaded_wk1),
         count(*) filter (where not downloaded_wk1 and retained)
  from features
  union all
  select 'added_job_wk1',
         count(*) filter (where added_job_wk1),
         count(*) filter (where added_job_wk1 and retained),
         count(*) filter (where not added_job_wk1),
         count(*) filter (where not added_job_wk1 and retained)
  from features
) s
order by lift desc;
