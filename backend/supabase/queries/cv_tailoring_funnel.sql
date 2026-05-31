-- =============================================================================
-- CV Tailoring Funnel Report
-- =============================================================================
-- The end-to-end tailoring funnel, per user, then aggregated:
--   1. Uploaded / created a CV          (master_cvs)
--   2. Entered a job description        (jobs with non-empty job_description)
--   3. Generated a tailored CV          (tailored_cvs / ai_runs tailored_draft)
--   4. Edited the tailored CV           (cv_block_revisions or applied suggestions)
--   5. Downloaded it                    (completed export of a tailored CV)
--   6. Repeated for another job         (>= 2 jobs that produced a tailored CV)
--
-- Tables: public.master_cvs, public.jobs, public.tailored_cvs, public.ai_runs,
--         public.cv_block_revisions, public.ai_suggestions, public.exports
--
-- Each stage is gated on the previous one being reachable, so the counts read as
-- a true funnel. Stage flags are computed per user, then rolled up.
-- =============================================================================

with users_base as (
  select id as user_id from public.users
),

-- Stage 1: has at least one (non-deleted) master CV.
has_master as (
  select distinct user_id
  from public.master_cvs
  where is_deleted = false
),

-- Stage 2: entered a job description.
has_job_desc as (
  select distinct user_id
  from public.jobs
  where job_description is not null
    and length(btrim(job_description)) > 0
),

-- Stage 3: generated a tailored CV.
has_tailored as (
  select distinct user_id
  from public.tailored_cvs
  where is_deleted = false
),

-- Stage 4: edited a tailored CV (manual or AI-applied block changes).
edited_tailored as (
  select distinct user_id
  from public.cv_block_revisions
  where cv_kind = 'tailored'
    and change_source in ('manual', 'ai', 'restore')
  union
  select distinct user_id
  from public.ai_suggestions
  where status = 'applied'
    and tailored_cv_id is not null
),

-- Stage 5: downloaded (completed export of a tailored CV).
downloaded_tailored as (
  select distinct user_id
  from public.exports
  where status = 'completed'
    and tailored_cv_id is not null
),

-- Stage 6: repeated the loop for another job
-- (tailored CVs spanning 2+ distinct jobs).
repeated_for_another_job as (
  select user_id
  from public.tailored_cvs
  where is_deleted = false
    and job_id is not null
  group by user_id
  having count(distinct job_id) >= 2
),

per_user as (
  select
    ub.user_id,
    (hm.user_id  is not null)                                   as s1_has_master,
    (hm.user_id  is not null and hj.user_id is not null)        as s2_entered_job,
    (hm.user_id  is not null and hj.user_id is not null
       and ht.user_id is not null)                              as s3_generated_tailored,
    (ht.user_id  is not null and et.user_id is not null)        as s4_edited,
    (ht.user_id  is not null and dt.user_id is not null)        as s5_downloaded,
    (rr.user_id  is not null)                                   as s6_repeated
  from users_base ub
  left join has_master              hm on hm.user_id = ub.user_id
  left join has_job_desc            hj on hj.user_id = ub.user_id
  left join has_tailored            ht on ht.user_id = ub.user_id
  left join edited_tailored         et on et.user_id = ub.user_id
  left join downloaded_tailored     dt on dt.user_id = ub.user_id
  left join repeated_for_another_job rr on rr.user_id = ub.user_id
)

select
  stage,
  users_reached,
  -- conversion vs. the very top of the funnel
  round(users_reached::numeric / nullif(max(users_reached) over (), 0), 3)
                                                          as pct_of_top,
  -- step-to-step conversion (vs. the previous stage)
  round(
    users_reached::numeric
    / nullif(lag(users_reached) over (order by stage_order), 0), 3
  )                                                       as step_conversion
from (
  select 1 as stage_order, '1. Uploaded / created CV'     as stage, count(*) filter (where s1_has_master)        as users_reached from per_user
  union all
  select 2, '2. Entered job description',                 count(*) filter (where s2_entered_job)         from per_user
  union all
  select 3, '3. Generated tailored CV',                   count(*) filter (where s3_generated_tailored)  from per_user
  union all
  select 4, '4. Edited tailored CV',                      count(*) filter (where s4_edited)              from per_user
  union all
  select 5, '5. Downloaded tailored CV',                  count(*) filter (where s5_downloaded)          from per_user
  union all
  select 6, '6. Repeated for another job',                count(*) filter (where s6_repeated)            from per_user
) f
order by stage_order;

-- -----------------------------------------------------------------------------
-- Optional companion: volume metrics (not a per-user funnel, raw throughput).
-- Run separately if you want absolute counts and the loop's repeat ratio.
-- -----------------------------------------------------------------------------
-- select
--   (select count(*) from public.master_cvs where is_deleted = false)              as master_cvs,
--   (select count(*) from public.jobs)                                             as jobs_with_desc,
--   (select count(*) from public.tailored_cvs where is_deleted = false)            as tailored_cvs,
--   (select count(*) from public.exports
--      where status = 'completed' and tailored_cv_id is not null)                  as tailored_downloads,
--   round(
--     (select count(*) from public.tailored_cvs where is_deleted = false)::numeric
--     / nullif((select count(distinct user_id) from public.tailored_cvs
--                 where is_deleted = false), 0), 2)                                as avg_tailored_cvs_per_active_user;
