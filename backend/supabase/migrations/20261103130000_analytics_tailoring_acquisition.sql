-- Admin analytics Phase 4 (part B): Tailoring and Acquisition metrics (docs/admin-analytics/metrics-plan.md "Phase 4",
-- Tailoring and Acquisition rows; api-contract.md). Ports of the KB queries new_analysis/tailoring/*.md,
-- new_analysis/acquisition/{onboarding_segment_performance,import_quality_impact,translation_and_language_adoption}.md
-- and queries/{user_funnel_signup_to_application,user_acquisition_activation_report,cv_import_success_funnel}.md.
-- Conventions follow 20261031120000_analytics_overview.sql:
-- - UTC days; behavioural data of analysis_users only (accounts pending deletion or restricted are dropped), internal
--   accounts excluded unless p_include_internal; mock AI runs never count.
-- - Market = the account's locked market ('unknown' without one); locale = users.locale (current value, no history).
-- - Era cutoffs are applied, never mixed silently: tailoring v2 from 2026-10-27, guest-upload onboarding and
--   onboarding answers from 2026-10-06 (the manual-signup marker only from 2026-10-26), import diagnostics
--   (review_context) from 2026-10-06.
-- - Onboarding answers are segments only for users with analytics consent (users.analytics), so onboarding_segments
--   is consent-scoped; the onboarding path is operational data (counted for every visitor) and is not.
-- Every metric is computed live; the data is small and the hot paths use existing per-user / per-session indexes.

-- ---------------------------------------------------------------------------
-- Shared definitions
-- ---------------------------------------------------------------------------

-- Signup path (KB users.md / onboarding_segment_performance): 'upload' = owns a claimed guest upload (source_upload
-- under guests/), 'manual_create' = counted by count_manual_onboarding_signup (marker from 2026-10-26), else
-- 'direct'. Manual-path signups between 2026-10-06 and 2026-10-25, and every signup before 2026-10-06, are 'direct'.
create view analytics_private.user_onboarding_paths as
select u.id as user_id,
       case
         when exists (select 1 from public.files f
                      where f.user_id = u.id
                        and f.file_type = 'source_upload'
                        and f.storage_path like 'guests/%') then 'upload'
         when u.onboarding_metrics_counted_at is not null then 'manual_create'
         else 'direct'
       end as onboarding_path
from public.users u;

-- Text -> timestamptz for app-written JSON timestamps; null when the value is missing or not a valid timestamp
-- (impossible dates, offsets or garbage), so one bad row never aborts a metric.
create function analytics_private.try_timestamptz(p_text text) returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end $$;

-- Tailoring v2 sessions created in [p_start, p_end) and not before the v2 launch (2026-10-27), of analysis accounts
-- (internal ones only when p_include_internal), narrowed by p_filters market / locale (other keys are validated by
-- the caller). A session with any mock run is test data and is dropped (KB). Detached sessions (tailored CV deleted)
-- recover their CV from the analysis run, which keeps tailored_cv_id. Metadata only: no session content leaves.
create function analytics_private.tailoring_v2_sessions(
  p_start timestamptz, p_end timestamptz, p_include_internal boolean, p_filters jsonb
)
returns table (
  session_id uuid, user_id uuid, job_id uuid, cv_id uuid, created_at timestamptz, finished_at timestamptz,
  questions_completed boolean, analysis_run_id uuid, analysis_completed_at timestamptz, is_detached boolean,
  has_analysis boolean, n_questions integer, last_answer_at timestamptz, errored boolean, market text, locale text
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
begin
  return query
  select s.id, s.user_id, s.job_id, coalesce(s.tailored_cv_id, ar.tailored_cv_id), s.created_at, s.finished_at,
         s.questions_completed, s.analysis_run_id, ar.completed_at, (s.tailored_cv_id is null),
         (s.analysis is not null),
         -- null = not analysed or detached (scrubbed)
         case when jsonb_typeof(s.analysis -> 'questions') = 'array' then jsonb_array_length(s.analysis -> 'questions')
              when s.analysis is not null then 0 end,
         -- Latest answered_at over the answer keys (written on skips too, overwritten on re-answers).
         -- An unparseable value is ignored instead of aborting the metric.
         (select max(analytics_private.try_timestamptz(a.value ->> 'answered_at'))
          from jsonb_each(case when jsonb_typeof(s.answers) = 'object' then s.answers else '{}'::jsonb end) a
          where jsonb_typeof(a.value) = 'object'),
         (s.error_message is not null),
         coalesce(bm.market, 'unknown'),
         u.locale
  from public.tailoring_sessions s
  join analytics_private.analysis_users u on u.id = s.user_id
  left join public.billing_markets bm on bm.user_id = s.user_id
  left join public.ai_runs ar on ar.id = s.analysis_run_id
  where s.created_at >= greatest(p_start, timestamptz '2026-10-27 00:00:00+00')
    and s.created_at < p_end
    and (p_include_internal or not u.is_internal)
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
    and (v_locales is null or u.locale = any (v_locales))
    and not exists (select 1 from public.ai_runs m where m.tailoring_session_id = s.id and m.provider = 'mock');
end $$;

-- KB tailoring_session_funnel_timing per session: step flags, the step timestamps and the seconds between steps.
-- Sessions created p_from..p_to (UTC days). Exports count for a session only until the next session on the same CV
-- starts (a re-tailor), so an export is never credited to two sessions; applied / interview are the job's first
-- move into applied|interview|offer (interview|offer) at or after the session start.
create function analytics_private.tailoring_v2_session_steps(
  p_from date, p_to date, p_include_internal boolean, p_filters jsonb
)
returns table (
  session_id uuid, user_id uuid, created_at timestamptz, market text, locale text,
  analysed boolean, has_questions boolean, passed_questions boolean, finished boolean, exported boolean,
  applied boolean, interview_or_offer boolean, errored boolean, failed_tasks bigint, last_step text,
  s_analysis numeric, s_answers numeric, s_finish numeric, s_export numeric, s_apply numeric, s_interview numeric
)
language sql stable set search_path = ''
as $$
  with s as (
    select * from analytics_private.tailoring_v2_sessions(
      analytics_private.utc_start(p_from), analytics_private.utc_start(p_to + 1), p_include_internal, p_filters)
  ),
  -- One pass over the v2 sessions of the scoped CVs (detached ones recover their CV from the analysis run).
  nexts as (
    select y.id, lead(y.created_at) over (partition by y.cv_id order by y.created_at, y.id) as next_at
    from (
      select x.id, coalesce(x.tailored_cv_id, ar.tailored_cv_id) as cv_id, x.created_at
      from public.tailoring_sessions x
      left join public.ai_runs ar on ar.id = x.analysis_run_id
      where x.created_at >= timestamptz '2026-10-27 00:00:00+00'
    ) y
    where y.cv_id in (select s.cv_id from s)
  ),
  f as (
    select s.*,
           (s.analysis_run_id is not null) as is_analysed,
           (s.analysis_run_id is not null and coalesce(s.n_questions, 0) > 0) as is_q,
           ex.first_export_at,
           jo.applied_at_eff,
           jo.first_interview_at,
           tk.failed_tasks
    from s
    -- Next session on the same CV (live or detached), capping the export window.
    left join nexts nx on nx.id = s.session_id
    left join lateral (
      select min(e.completed_at) as first_export_at
      from public.exports e
      where e.tailored_cv_id = s.cv_id
        and e.status = 'completed'
        and e.completed_at >= s.created_at
        and (nx.next_at is null or e.completed_at < nx.next_at)
    ) ex on true
    left join lateral (
      select least(j.applied_at, h.first_applied_at) as applied_at_eff, h.first_interview_at
      from public.jobs j
      left join lateral (
        select min(jh.changed_at) filter (where jh.to_status in ('applied', 'interview', 'offer')) as first_applied_at,
               min(jh.changed_at) filter (where jh.to_status in ('interview', 'offer')) as first_interview_at
        from public.job_status_history jh
        where jh.job_id = j.id
      ) h on true
      where j.id = s.job_id
    ) jo on true
    left join lateral (
      select count(*) as failed_tasks
      from public.tailoring_session_tasks t
      where t.session_id = s.session_id and t.status = 'failed'
    ) tk on true
  ),
  g as (
    select f.*,
           (f.is_analysed and f.finished_at is not null) as is_finished,
           (f.first_export_at is not null) as is_exported,
           coalesce(f.applied_at_eff >= f.created_at, false) as is_applied,
           coalesce(f.first_interview_at >= f.created_at, false) as is_interview
    from f
  )
  select g.session_id, g.user_id, g.created_at, g.market, g.locale,
         g.is_analysed,
         g.is_q,
         (g.is_q and g.questions_completed),
         g.is_finished,
         g.is_exported,
         g.is_applied,
         g.is_interview,
         g.errored,
         g.failed_tasks,
         -- The furthest step of the strict chain the session reached.
         case when g.is_finished and g.is_exported and g.is_applied and g.is_interview then 'interview_or_offer'
              when g.is_finished and g.is_exported and g.is_applied then 'applied'
              when g.is_finished and g.is_exported then 'exported'
              when g.is_finished then 'finished'
              when g.is_analysed then 'analysed'
              else 'session_started' end,
         case when g.is_analysed and g.analysis_completed_at >= g.created_at
              then extract(epoch from g.analysis_completed_at - g.created_at) end,
         case when g.is_q and g.questions_completed and g.last_answer_at >= g.analysis_completed_at
              then extract(epoch from g.last_answer_at - g.analysis_completed_at) end,
         case when g.is_finished and g.finished_at >= coalesce(g.last_answer_at, g.analysis_completed_at)
              then extract(epoch from g.finished_at - coalesce(g.last_answer_at, g.analysis_completed_at)) end,
         case when g.is_finished and g.is_exported and g.first_export_at >= g.finished_at
              then extract(epoch from g.first_export_at - g.finished_at) end,
         case when g.is_finished and g.is_exported and g.is_applied and g.applied_at_eff >= g.first_export_at
              then extract(epoch from g.applied_at_eff - g.first_export_at) end,
         case when g.is_finished and g.is_exported and g.is_applied and g.is_interview
                   and g.first_interview_at >= g.applied_at_eff
              then extract(epoch from g.first_interview_at - g.applied_at_eff) end
  from g
$$;

-- Signups p_from..p_to (UTC days) of analysis accounts with the first time they reached each activation milestone
-- (null = never). Callers apply the 7-day window of analytics.kpi_overview: a milestone counts when it happened
-- before created_at + 7 days; eligible = that window has closed. Filters: market, locale, onboarding_path.
create function analytics_private.signup_activation(p_from date, p_to date, p_include_internal boolean, p_filters jsonb)
returns table (
  user_id uuid, created_at timestamptz, eligible boolean, market text, locale text, onboarding_path text,
  imported_at timestamptz, master_at timestamptz, tailored_at timestamptz, exported_at timestamptz, applied_at timestamptz
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_markets text[] := analytics_private.filter_values(p_filters, 'market');
  v_locales text[] := analytics_private.filter_values(p_filters, 'locale');
  v_paths text[] := analytics_private.filter_values(p_filters, 'onboarding_path');
begin
  return query
  select u.id, u.created_at, (u.created_at + interval '7 days' <= now()),
         coalesce(bm.market, 'unknown'), u.locale, op.onboarding_path,
         imp.at, mc.at, tc.at, ex.at, ap.at
  from analytics_private.analysis_users u
  join analytics_private.user_onboarding_paths op on op.user_id = u.id
  left join public.billing_markets bm on bm.user_id = u.id
  -- A successfully parsed upload (KB activation report: parsed / reviewed / converted); dev mock parses excluded.
  left join lateral (
    select min(i.created_at) as at from public.imports i
    where i.user_id = u.id and i.status in ('parsed', 'reviewed', 'converted')
      and i.parser_name is distinct from 'mock_cv_parser_v1'
  ) imp on true
  -- Soft-deleted CVs count: the milestone happened.
  left join lateral (select min(m.created_at) as at from public.master_cvs m where m.user_id = u.id) mc on true
  left join lateral (select min(t.created_at) as at from public.tailored_cvs t where t.user_id = u.id) tc on true
  left join lateral (
    select min(e.completed_at) as at from public.exports e where e.user_id = u.id and e.status = 'completed'
  ) ex on true
  -- First move of any job to applied / interview / offer (applied_at or status history, else updated_at), as in
  -- analytics.ai_cost_per_outcome.
  left join lateral (
    select min(coalesce(least(j.applied_at, h.first_at), j.updated_at)) as at
    from public.jobs j
    left join lateral (
      select min(jh.changed_at) as first_at from public.job_status_history jh
      where jh.job_id = j.id and jh.to_status in ('applied', 'interview', 'offer')
    ) h on true
    where j.user_id = u.id
      and (j.applied_at is not null or j.status in ('applied', 'interview', 'offer') or h.first_at is not null)
  ) ap on true
  where (p_include_internal or not u.is_internal)
    and u.created_at >= analytics_private.utc_start(p_from)
    and u.created_at < analytics_private.utc_start(p_to + 1)
    and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
    and (v_locales is null or u.locale = any (v_locales))
    and (v_paths is null or op.onboarding_path = any (v_paths));
end $$;

-- ---------------------------------------------------------------------------
-- analytics.tailoring_funnel
-- ---------------------------------------------------------------------------

create function analytics.tailoring_funnel(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  step_order integer, step text, dimension text, users bigint, conversion_from_prev numeric, conversion_from_start numeric,
  dropped bigint, distinct_users bigint, timed_sessions bigint, median_seconds_from_prev numeric, p90_seconds_from_prev numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'locale'], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with s as (
    select x.*,
           case p_breakdown when 'market' then x.market when 'locale' then x.locale end as dim
    from analytics_private.tailoring_v2_session_steps(r.from_day, r.to_day, p_include_internal, p_filters) x
  ),
  dims as (
    select distinct s.dim from s
    union
    select null where p_breakdown is null
  ),
  -- One row per session and step: reached, its base (the KB step denominator), and the seconds from the previous step.
  per as (
    select s.dim, v.step_order, v.reached, v.base, v.secs, s.user_id
    from s
    cross join lateral (values
      (1, true, null::boolean, null::numeric),
      (2, s.analysed, true, s.s_analysis),
      (3, s.passed_questions, s.has_questions, s.s_answers),
      (4, s.finished, s.analysed, s.s_finish),
      (5, s.finished and s.exported, s.finished, s.s_export),
      (6, s.finished and s.exported and s.applied, s.finished and s.exported, s.s_apply),
      (7, s.finished and s.exported and s.applied and s.interview_or_offer, s.finished and s.exported and s.applied, s.s_interview)
    ) v(step_order, reached, base, secs)
  ),
  agg as (
    select p.dim, p.step_order,
           count(*) filter (where p.reached) as n,
           count(*) filter (where p.base) as base_n,
           count(*) filter (where p.base and not p.reached) as n_dropped,
           count(distinct p.user_id) filter (where p.reached) as n_users,
           count(p.secs) as n_timed,
           percentile_cont(0.5) within group (order by p.secs) as p50,
           percentile_cont(0.9) within group (order by p.secs) as p90
    from per p
    group by p.dim, p.step_order
  ),
  starts as (
    select a.dim, a.n from agg a where a.step_order = 1
  )
  select st.step_order, st.step, d.dim,
         coalesce(a.n, 0),
         case when st.step_order = 1 then null else round(a.n::numeric / nullif(a.base_n, 0), 4) end,
         round(coalesce(a.n, 0)::numeric / nullif(t.n, 0), 4),
         case when st.step_order = 1 then null else coalesce(a.n_dropped, 0) end,
         coalesce(a.n_users, 0),
         case when st.step_order = 1 then null else coalesce(a.n_timed, 0) end,
         round(a.p50::numeric, 0),
         round(a.p90::numeric, 0)
  from dims d
  cross join (values (1, 'session_started'), (2, 'analysed'), (3, 'passed_questions'), (4, 'finished'),
                     (5, 'exported'), (6, 'applied'), (7, 'interview_or_offer')) st(step_order, step)
  left join agg a on a.dim is not distinct from d.dim and a.step_order = st.step_order
  left join starts t on t.dim is not distinct from d.dim
  order by d.dim nulls first, st.step_order;
end $$;

comment on function analytics.tailoring_funnel(date, date, text, text, boolean, text, jsonb) is
'{"title":"Tailoring funnel","definition":"Tailoring v2 sessions created in the range (UTC; v2 exists from 2026-10-27, earlier days are empty) through their steps (KB tailoring_session_funnel_timing B and C). The users column counts sessions; distinct_users counts accounts. Steps: session_started; analysed = has an analysis run; passed_questions = completed the questions, over analysed sessions with at least one question (a side step: users can finish without it, so the next step is based on analysed); finished = Finish clicked (finished_at, the last click), over analysed; exported = a completed export of the session''s CV after the session started and before the next session on the same CV, over finished; applied = the job''s first move to applied / interview / offer at or after the session start, over finished and exported; interview_or_offer = the first move to interview / offer, over applied. From finished on the steps form a strict chain. conversion_from_prev = step / its base, conversion_from_start = step / sessions, dropped = base - step. Timing: median_seconds_from_prev / p90_seconds_from_prev between the previous step and this one (created -> analysis completed, analysis -> last answer, last answer (else analysis) -> finish, finish -> first export, first export -> applied, applied -> interview), negative gaps dropped, each over timed_sessions. Detached sessions (CV deleted) keep their analysis, finish and job, but their scrubbed answers drop them from the questions step. Sessions with any mock run, accounts pending deletion or restricted, and internal accounts unless included are excluded; erased accounts are gone (survivorship). Market = the account''s locked market (unknown without one), locale = the current UI locale. Recent sessions have had little time to export or apply. Grain and currency do not apply. Dashboard definition: one funnel for the range instead of weekly cohorts; timing in seconds instead of minutes, extended to the applied and interview steps; the v1 comparison (KB D) is not ported.","unit":"count","shape":"funnel","breakdowns":["market","locale"],"filters":["market","locale"],"kb":"new_analysis/tailoring/tailoring_session_funnel_timing.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"measures":{"users":{"label":"Sessions","unit":"count","description":"Sessions reaching the step"},"conversion_from_prev":{"label":"Step conversion","unit":"ratio","description":"Step / its base (questions: over analysed sessions with questions)"},"conversion_from_start":{"label":"Conversion from start","unit":"ratio","description":"Step / sessions started"},"dropped":{"label":"Dropped","unit":"count","description":"Sessions in the step''s base that did not reach it"},"distinct_users":{"label":"Users","unit":"count","description":"Distinct accounts reaching the step"},"timed_sessions":{"label":"Timed sessions","unit":"count","description":"Sessions with a measurable gap from the previous step"},"median_seconds_from_prev":{"label":"Median time from previous step","unit":"seconds"},"p90_seconds_from_prev":{"label":"p90 time from previous step","unit":"seconds"}}}';

-- ---------------------------------------------------------------------------
-- analytics.tailoring_task_reliability
-- ---------------------------------------------------------------------------

create function analytics.tailoring_task_reliability(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  bucket date, dimension text, task_failure_rate numeric, tasks bigint, done_tasks bigint, skipped_tasks bigint,
  failed_tasks bigint, open_tasks bigint, block_failure_rate numeric, summary_failure_rate numeric,
  skills_failure_rate numeric, structure_failure_rate numeric, avg_attempts numeric, rerun_share numeric,
  done_without_card_share numeric, p50_task_seconds numeric, p95_task_seconds numeric,
  run_failure_rate numeric, runs bigint, failed_runs bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_models text[];
  v_providers text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['ai_model', 'ai_provider', 'market', 'locale'], array['ai_model', 'ai_provider', 'market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_models := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers := analytics_private.filter_values(p_filters, 'ai_provider');

  return query
  with sess as (
    -- Every v2 session that can own a task or run of the range (sessions precede their tasks).
    select * from analytics_private.tailoring_v2_sessions(timestamptz '2026-10-27 00:00:00+00', v_end, p_include_internal, p_filters)
  ),
  tasks as (
    select analytics_private.bucket(t.created_at, p_grain) as b,
           case p_breakdown when 'ai_model' then coalesce(ar.model_name, '(no run)')
                            when 'ai_provider' then coalesce(ar.provider, '(no run)')
                            when 'market' then s.market
                            when 'locale' then s.locale end as dim,
           t.kind, t.status, t.attempts,
           case when t.status = 'done' and t.started_at is not null and t.completed_at >= t.started_at
                then extract(epoch from t.completed_at - t.started_at) end as secs,
           -- Done with no card from its latest run (the model proposed no change).
           (t.status = 'done' and not exists (
              select 1 from public.ai_suggestions c
              where c.ai_run_id = t.ai_run_id and c.tailoring_task_id = t.id)) as done_no_card
    from public.tailoring_session_tasks t
    join sess s on s.session_id = t.session_id
    left join public.ai_runs ar on ar.id = t.ai_run_id
    where t.created_at >= v_start and t.created_at < v_end
      and (v_models is null or ar.model_name = any (v_models))
      and (v_providers is null or ar.provider = any (v_providers))
  ),
  -- Every task run (all attempts, failed ones included; ai_runs keeps what the task row overwrites).
  runs as (
    select analytics_private.bucket(ar.started_at, p_grain) as b,
           case p_breakdown when 'ai_model' then ar.model_name
                            when 'ai_provider' then ar.provider
                            when 'market' then s.market
                            when 'locale' then s.locale end as dim,
           ar.status
    from public.ai_runs ar
    join sess s on s.session_id = ar.tailoring_session_id
    where ar.flow_type in ('tailoring_block', 'tailoring_skills', 'tailoring_structure')
      and ar.provider <> 'mock'
      and ar.started_at >= v_start and ar.started_at < v_end
      and (v_models is null or ar.model_name = any (v_models))
      and (v_providers is null or ar.provider = any (v_providers))
  ),
  dims as (
    select distinct tasks.dim from tasks
    union
    select distinct runs.dim from runs
    union
    select null where p_breakdown is null
  ),
  task_agg as (
    select k.b, d.dim,
           count(t.b) as n,
           count(*) filter (where t.status = 'done') as n_done,
           count(*) filter (where t.status = 'skipped') as n_skipped,
           count(*) filter (where t.status = 'failed') as n_failed,
           count(*) filter (where t.status in ('waiting', 'ready', 'running')) as n_open,
           count(*) filter (where t.status in ('done', 'skipped', 'failed')) as n_terminal,
           count(*) filter (where t.kind = 'block' and t.status = 'failed') as f_block,
           count(*) filter (where t.kind = 'block' and t.status in ('done', 'skipped', 'failed')) as t_block,
           count(*) filter (where t.kind = 'summary' and t.status = 'failed') as f_summary,
           count(*) filter (where t.kind = 'summary' and t.status in ('done', 'skipped', 'failed')) as t_summary,
           count(*) filter (where t.kind = 'skills' and t.status = 'failed') as f_skills,
           count(*) filter (where t.kind = 'skills' and t.status in ('done', 'skipped', 'failed')) as t_skills,
           count(*) filter (where t.kind = 'structure' and t.status = 'failed') as f_structure,
           count(*) filter (where t.kind = 'structure' and t.status in ('done', 'skipped', 'failed')) as t_structure,
           avg(t.attempts) filter (where t.attempts > 0) as avg_att,
           count(*) filter (where t.attempts > 1) as n_rerun,
           count(*) filter (where t.attempts > 0) as n_run,
           count(*) filter (where t.done_no_card) as n_no_card,
           percentile_cont(0.5) within group (order by t.secs) as p50,
           percentile_cont(0.95) within group (order by t.secs) as p95
    from analytics_private.buckets(r.from_day, r.to_day, p_grain) k(b)
    cross join dims d
    left join tasks t on t.b = k.b and t.dim is not distinct from d.dim
    group by k.b, d.dim
  ),
  run_agg as (
    select ru.b, ru.dim,
           count(*) as n,
           count(*) filter (where ru.status = 'failed') as n_failed,
           count(*) filter (where ru.status in ('completed', 'failed')) as n_terminal
    from runs ru
    group by ru.b, ru.dim
  )
  select ta.b, ta.dim,
         round(ta.n_failed::numeric / nullif(ta.n_terminal, 0), 4),
         ta.n, ta.n_done, ta.n_skipped, ta.n_failed, ta.n_open,
         round(ta.f_block::numeric / nullif(ta.t_block, 0), 4),
         round(ta.f_summary::numeric / nullif(ta.t_summary, 0), 4),
         round(ta.f_skills::numeric / nullif(ta.t_skills, 0), 4),
         round(ta.f_structure::numeric / nullif(ta.t_structure, 0), 4),
         round(ta.avg_att, 2),
         round(ta.n_rerun::numeric / nullif(ta.n_run, 0), 4),
         round(ta.n_no_card::numeric / nullif(ta.n_done, 0), 4),
         round(ta.p50::numeric, 1),
         round(ta.p95::numeric, 1),
         round(ra.n_failed::numeric / nullif(ra.n_terminal, 0), 4),
         coalesce(ra.n, 0),
         coalesce(ra.n_failed, 0)
  from task_agg ta
  left join run_agg ra on ra.b = ta.b and ra.dim is not distinct from ta.dim
  order by ta.b, ta.dim;
end $$;

comment on function analytics.tailoring_task_reliability(date, date, text, text, boolean, text, jsonb) is
'{"title":"Tailoring task reliability","definition":"Tailoring v2 generation tasks per creation date (UTC) of sessions from 2026-10-27 (KB tailoring_task_reliability A, B, D, E). tailoring_session_tasks holds only the current task set (a retried analysis recreates every task, detaching a CV deletes them) and each row keeps only its latest run, so task columns describe surviving tasks. task_failure_rate = failed / (done + skipped + failed); open tasks (waiting, ready, running) stay out of the denominator; the per-kind rates (block, summary, skills, structure) use the same rule. avg_attempts and rerun_share (tasks with more than one attempt) are over tasks that ran at least once; attempts include retries, regenerations, quick fixes, refines and answer re-runs. done_without_card_share = done tasks whose latest run produced no card. p50 / p95_task_seconds = latest-run latency of done tasks (completed_at - started_at). run_failure_rate, runs and failed_runs count every task run in ai_runs (tailoring_block / skills / structure, all attempts) by start date: failed / (completed + failed). ai_model / ai_provider are the model of the task''s latest run (no-run tasks are ''(no run)'' and drop out under a model filter) and of each run. Sessions with any mock run, accounts pending deletion or restricted, and internal accounts unless included are excluded. Market = the account''s locked market, locale = the current UI locale. Currency does not apply. Dashboard definition: a time series by task creation date instead of the KB''s all-time tables per kind; the per-kind split is four plotted rate columns (task kind is not a dashboard dimension).","unit":"ratio","shape":"timeseries","breakdowns":["ai_model","ai_provider","market","locale"],"filters":["ai_model","ai_provider","market","locale"],"kb":"new_analysis/tailoring/tailoring_task_reliability.md","consent_scoped":false,"alertable":false,"min_group":5,"plot":["block_failure_rate","summary_failure_rate","skills_failure_rate","structure_failure_rate"],"measures":{"task_failure_rate":{"label":"Task failure rate","unit":"ratio","description":"failed / (done + skipped + failed)"},"tasks":{"label":"Tasks","unit":"count"},"done_tasks":{"label":"Done","unit":"count"},"skipped_tasks":{"label":"Skipped","unit":"count","description":"Nothing to rewrite; no AI call"},"failed_tasks":{"label":"Failed","unit":"count"},"open_tasks":{"label":"Open","unit":"count","description":"Waiting, ready or running"},"block_failure_rate":{"label":"Block tasks","unit":"ratio"},"summary_failure_rate":{"label":"Summary tasks","unit":"ratio"},"skills_failure_rate":{"label":"Skills tasks","unit":"ratio"},"structure_failure_rate":{"label":"Structure tasks","unit":"ratio"},"avg_attempts":{"label":"Attempts per run task","unit":"count"},"rerun_share":{"label":"Rerun share","unit":"ratio","description":"Tasks with more than one attempt"},"done_without_card_share":{"label":"Done without a card","unit":"ratio"},"p50_task_seconds":{"label":"Median task duration","unit":"seconds","description":"Latest run of done tasks"},"p95_task_seconds":{"label":"p95 task duration","unit":"seconds","description":"Latest run of done tasks"},"run_failure_rate":{"label":"Run failure rate","unit":"ratio","description":"All attempts in ai_runs: failed / (completed + failed)"},"runs":{"label":"Task runs","unit":"count"},"failed_runs":{"label":"Failed task runs","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.tailoring_card_acceptance
-- ---------------------------------------------------------------------------

create function analytics.tailoring_card_acceptance(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, driver text, acceptance_rate numeric, cards bigint, decided bigint, applied bigint, rejected bigint,
  pending bigint, expired bigint, applied_share numeric, rejected_share numeric, expired_share numeric,
  pending_share numeric, edited_share numeric, sessions bigint, users bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_models text[];
  v_providers text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['ai_model', 'ai_provider', 'market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_models := analytics_private.filter_values(p_filters, 'ai_model');
  v_providers := analytics_private.filter_values(p_filters, 'ai_provider');

  return query
  with sess as (
    select * from analytics_private.tailoring_v2_sessions(timestamptz '2026-10-27 00:00:00+00', v_end, p_include_internal, p_filters)
  ),
  -- v2 cards (the session copies, not the add-to-main master copies) created in the range, from a non-mock run.
  cards as (
    select c.id, c.tailoring_session_id as session_id, c.user_id, c.status,
           coalesce(c.kind, '(none)') as kind,
           coalesce(c.suggested_content ->> 'edited', 'false') = 'true' as edited,
           (jsonb_typeof(c.meta -> 'guard_notes') = 'array' and jsonb_array_length(c.meta -> 'guard_notes') > 0) as guarded,
           case when ar.input_payload = '{}'::jsonb then 'unknown (payload wiped)'
                when ar.input_payload -> 'flow_input' ? 'candidate_request' then 'refine'
                when ar.input_payload -> 'flow_input' ? 'refinement' then 'quick_fix'
                else 'initial' end as run_type,
           coalesce(u.preferences ->> 'tailoring_auto_apply', 'false') = 'true' as auto_apply
    from public.ai_suggestions c
    join sess s on s.session_id = c.tailoring_session_id
    join public.ai_runs ar on ar.id = c.ai_run_id and ar.provider <> 'mock'
    join public.users u on u.id = c.user_id
    where c.action_type = 'tailor'
      and c.created_at >= v_start and c.created_at < v_end
      and (v_models is null or ar.model_name = any (v_models))
      and (v_providers is null or ar.provider = any (v_providers))
  ),
  -- Cards collapsed per session and driver combination first (a session holds many cards), then fanned out to
  -- one row per driver value: the distinct session / user counts then sort far fewer rows.
  grouped as (
    select c.session_id, c.user_id, c.kind, c.run_type, c.guarded, c.auto_apply,
           count(*) as n,
           count(*) filter (where c.status = 'applied') as n_applied,
           count(*) filter (where c.status = 'rejected') as n_rejected,
           count(*) filter (where c.status = 'pending') as n_pending,
           count(*) filter (where c.status = 'expired') as n_expired,
           count(*) filter (where c.status = 'applied' and c.edited) as n_edited
    from cards c
    group by c.session_id, c.user_id, c.kind, c.run_type, c.guarded, c.auto_apply
  ),
  long as (
    select v.driver, v.label, g.*
    from grouped g
    cross join lateral (values
      ('all', 'all cards'),
      ('card_kind', 'kind: ' || g.kind),
      ('run_type', 'run type: ' || g.run_type),
      ('guard_notes', case when g.guarded then 'guard notes: present' else 'guard notes: none' end),
      ('auto_apply', case when g.auto_apply then 'auto-apply: on (current setting)' else 'auto-apply: off (current setting)' end)
    ) v(driver, label)
  ),
  agg as (
    select l.label, l.driver,
           sum(l.n)::bigint as n,
           sum(l.n_applied)::bigint as n_applied,
           sum(l.n_rejected)::bigint as n_rejected,
           sum(l.n_pending)::bigint as n_pending,
           sum(l.n_expired)::bigint as n_expired,
           sum(l.n_edited)::bigint as n_edited,
           count(distinct l.session_id) as n_sessions,
           count(distinct l.user_id) as n_users
    from long l
    group by l.label, l.driver
  ),
  -- The reference row always exists.
  rows_ as (
    select * from agg
    union all
    select 'all cards', 'all', 0, 0, 0, 0, 0, 0, 0, 0 where not exists (select 1 from agg)
  )
  select x.label, x.driver,
         round(x.n_applied::numeric / nullif(x.n_applied + x.n_rejected, 0), 4),
         x.n, x.n_applied + x.n_rejected, x.n_applied, x.n_rejected, x.n_pending, x.n_expired,
         round(x.n_applied::numeric / nullif(x.n, 0), 4),
         round(x.n_rejected::numeric / nullif(x.n, 0), 4),
         round(x.n_expired::numeric / nullif(x.n, 0), 4),
         round(x.n_pending::numeric / nullif(x.n, 0), 4),
         round(x.n_edited::numeric / nullif(x.n_applied, 0), 4),
         x.n_sessions, x.n_users
  from rows_ x
  order by 3 desc nulls last, x.n desc, x.label;
end $$;

comment on function analytics.tailoring_card_acceptance(date, date, text, text, boolean, text, jsonb) is
'{"title":"Tailoring card acceptance","definition":"Tailoring v2 suggestion cards created in the range (UTC) of sessions from 2026-10-27 (KB tailoring_card_acceptance_drivers A): ai_suggestions with action_type tailor and a session (the add-to-main copies on the master CV are excluded), from a non-mock run. One row per driver value; the dimension text names the driver: all cards; card kind; run type of the producing run (refine = flow_input.candidate_request, quick_fix = flow_input.refinement, else initial; answer re-runs and regenerates count as initial; unknown when a privacy action wiped the payload); guard notes (meta.guard_notes non-empty: the fact guards removed something); auto-apply (users.preferences.tailoring_auto_apply, the current setting with no history, so approximate). acceptance_rate = applied / (applied + rejected): expired cards were replaced by a regenerate, quick fix, refine or answer re-run without a user decision and are excluded, pending cards are undecided. applied_share, rejected_share, expired_share and pending_share are over all cards; edited_share = applied cards edited before accepting. Status is the final state only (undo returns a card to pending). Deleting a tailored CV deletes its cards (survivorship). Sessions with any mock run, accounts pending deletion or restricted, and internal accounts unless included are excluded. ai_model / ai_provider filter by the producing run; market = the account''s locked market, locale = the current UI locale. Grain and currency do not apply. Dashboard definition: cards dated by their creation inside the range; the kind x run type / kind x guard cross rows (KB A), requirement drivers (B) and per-user acceptance (C) are not ported.","unit":"ratio","shape":"breakdown","breakdowns":[],"filters":["ai_model","ai_provider","market","locale"],"kb":"new_analysis/tailoring/tailoring_card_acceptance_drivers.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"acceptance_rate":{"label":"Acceptance","unit":"ratio","description":"applied / (applied + rejected)"},"cards":{"label":"Cards","unit":"count"},"decided":{"label":"Decided cards","unit":"count","description":"Applied + rejected"},"applied":{"label":"Accepted","unit":"count"},"rejected":{"label":"Rejected","unit":"count"},"pending":{"label":"Pending","unit":"count","description":"Undecided"},"expired":{"label":"Expired","unit":"count","description":"Replaced without a decision"},"applied_share":{"label":"Accepted share","unit":"ratio","description":"Of all cards"},"rejected_share":{"label":"Rejected share","unit":"ratio","description":"Of all cards"},"expired_share":{"label":"Expired share","unit":"ratio","description":"Of all cards"},"pending_share":{"label":"Pending share","unit":"ratio","description":"Of all cards"},"edited_share":{"label":"Edited before accepting","unit":"ratio","description":"Of accepted cards"},"sessions":{"label":"Sessions","unit":"count"},"users":{"label":"Users","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.tailoring_questions
-- ---------------------------------------------------------------------------

create function analytics.tailoring_questions(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, answer_rate numeric, questions bigint, answered bigint, skipped_or_empty bigint, never_touched bigint,
  sessions bigint, sessions_with_kind bigint, session_share numeric, avg_per_session numeric, max_per_session bigint,
  gap_yes bigint, gap_some bigint, gap_no bigint, users bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with live as (
    -- Live (not detached), analysed sessions created in the range: detaching scrubs questions and answers.
    select s.session_id, s.user_id, ts.analysis, ts.answers
    from analytics_private.tailoring_v2_sessions(analytics_private.utc_start(r.from_day),
           analytics_private.utc_start(r.to_day + 1), p_include_internal, p_filters) s
    join public.tailoring_sessions ts on ts.id = s.session_id
    where not s.is_detached and s.has_analysis and s.analysis_run_id is not null
  ),
  -- One row per question of the latest analysis; only ids, kinds and answer presence are read.
  qs as (
    select l.session_id, l.user_id,
           coalesce(q ->> 'kind', '(none)') as kind,
           (l.answers ? (q ->> 'id')) as has_key,
           case q ->> 'kind'
             when 'gap' then l.answers -> (q ->> 'id') ->> 'answer' is not null
             when 'metric' then nullif(btrim(l.answers -> (q ->> 'id') ->> 'detail'), '') is not null
             else coalesce(jsonb_typeof(l.answers -> (q ->> 'id') -> 'entries') = 'array'
                           and jsonb_array_length(l.answers -> (q ->> 'id') -> 'entries') > 0, false)
           end as really,
           case when q ->> 'kind' = 'gap' then l.answers -> (q ->> 'id') ->> 'answer' end as gap_answer
    from live l
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(l.analysis -> 'questions') = 'array' then l.analysis -> 'questions' else '[]'::jsonb end) q
    where jsonb_typeof(q) = 'object'
  ),
  kinds as (
    select k.kind from (values ('gap'), ('metric'), ('metric_open')) k(kind)
    union
    select distinct qs.kind from qs
  ),
  per_session as (
    select l.session_id, l.user_id, k.kind,
           count(q.kind) as asked
    from live l
    cross join (select kind from kinds union all select 'all questions') k
    left join qs q on q.session_id = l.session_id and (k.kind = 'all questions' or q.kind = k.kind)
    group by l.session_id, l.user_id, k.kind
  ),
  agg as (
    select k.kind,
           count(q.session_id) as n,
           count(*) filter (where q.really) as n_really,
           count(*) filter (where q.has_key and not q.really) as n_skipped,
           count(*) filter (where not q.has_key) as n_untouched,
           count(*) filter (where q.gap_answer = 'yes') as n_yes,
           count(*) filter (where q.gap_answer = 'some') as n_some,
           count(*) filter (where q.gap_answer = 'no') as n_no
    from (select kind from kinds union all select 'all questions') k
    left join qs q on (k.kind = 'all questions' or q.kind = k.kind)
    group by k.kind
  ),
  sess_agg as (
    select p.kind,
           count(*) as n_sessions,
           count(*) filter (where p.asked > 0) as n_with,
           avg(p.asked) as avg_asked,
           max(p.asked) as max_asked,
           count(distinct p.user_id) filter (where p.asked > 0) as n_users
    from per_session p
    group by p.kind
  ),
  tot as (select count(*) as n from live)
  select a.kind,
         round(a.n_really::numeric / nullif(a.n, 0), 4),
         a.n, a.n_really, a.n_skipped, a.n_untouched,
         t.n,
         coalesce(sa.n_with, 0),
         round(coalesce(sa.n_with, 0)::numeric / nullif(t.n, 0), 4),
         round(sa.avg_asked, 2),
         sa.max_asked,
         case when a.kind in ('gap', 'all questions') then a.n_yes end,
         case when a.kind in ('gap', 'all questions') then a.n_some end,
         case when a.kind in ('gap', 'all questions') then a.n_no end,
         coalesce(sa.n_users, 0)
  from agg a
  cross join tot t
  left join sess_agg sa on sa.kind = a.kind
  order by 2 desc nulls last, a.n desc, a.kind;
end $$;

comment on function analytics.tailoring_questions(date, date, text, text, boolean, text, jsonb) is
'{"title":"Tailoring questions","definition":"Follow-up questions of live, analysed tailoring v2 sessions created in the range (UTC; from 2026-10-27) by question kind, plus an all-questions row (KB tailoring_question_engagement A, B and C counts). Only the latest analysis''s questions count (a retried analysis overwrites them); detached sessions (CV deleted) are scrubbed and drop out (survivorship). answer_rate = really answered / asked, with the KB''s per-kind test: gap = an answer (yes / some / no), metric = a non-empty detail, metric_open = at least one entry. An answer key appears on a skip too: skipped_or_empty = key present but not really answered, never_touched = no key. sessions = live analysed sessions in the population (the same on every row); sessions_with_kind / session_share = sessions asking at least one question of the kind; avg_per_session / max_per_session = questions per session (zeros included). gap_yes / gap_some / gap_no split gap answers (gap and all rows). By design gap <= 3, metric <= 2, metric_open <= 1 per session. Sessions with any mock run, accounts pending deletion or restricted, and internal accounts unless included are excluded. Market = the account''s locked market, locale = the current UI locale. Grain and currency do not apply. Dashboard definition: the add-to-main chain (KB D) and the acceptance / uplift comparison (KB E) are not ported.","unit":"ratio","shape":"breakdown","breakdowns":[],"filters":["market","locale"],"kb":"new_analysis/tailoring/tailoring_question_engagement.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"answer_rate":{"label":"Answer rate","unit":"ratio","description":"Really answered / asked"},"questions":{"label":"Questions asked","unit":"count"},"answered":{"label":"Really answered","unit":"count"},"skipped_or_empty":{"label":"Skipped or empty","unit":"count"},"never_touched":{"label":"Never touched","unit":"count"},"sessions":{"label":"Analysed sessions","unit":"count"},"sessions_with_kind":{"label":"Sessions asking","unit":"count"},"session_share":{"label":"Share of sessions asking","unit":"ratio"},"avg_per_session":{"label":"Questions per session","unit":"count"},"max_per_session":{"label":"Most in one session","unit":"count"},"gap_yes":{"label":"Gap answered yes","unit":"count"},"gap_some":{"label":"Gap answered some","unit":"count"},"gap_no":{"label":"Gap answered no","unit":"count"},"users":{"label":"Users asked","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.activation_funnel
-- ---------------------------------------------------------------------------

create function analytics.activation_funnel(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  step_order integer, step text, dimension text, users bigint, conversion_from_prev numeric, conversion_from_start numeric,
  dropped bigint, pending bigint, median_seconds_from_signup numeric
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array['market', 'locale', 'onboarding_path'], array['market', 'locale', 'onboarding_path']);
  select * into r from analytics_private.resolve_range(p_from, p_to);

  return query
  with a as (
    select x.*,
           case p_breakdown when 'market' then x.market when 'locale' then x.locale
                            when 'onboarding_path' then x.onboarding_path end as dim,
           coalesce(x.imported_at < x.created_at + interval '7 days', false) as r2,
           coalesce(x.master_at < x.created_at + interval '7 days', false) as r3,
           coalesce(x.tailored_at < x.created_at + interval '7 days', false) as r4,
           coalesce(x.exported_at < x.created_at + interval '7 days', false) as r5,
           coalesce(x.applied_at < x.created_at + interval '7 days', false) as r6
    from analytics_private.signup_activation(r.from_day, r.to_day, p_include_internal, p_filters) x
  ),
  dims as (
    select distinct a.dim from a
    union
    select null where p_breakdown is null
  ),
  -- One row per eligible signup and step: reached (within 7 days), base (reached the previous step), dropped
  -- (base but not reached; for signed_up: reached no later step) and the seconds from signup.
  per as (
    select a.dim, v.step_order, v.reached, v.base, v.drop_flag, v.secs
    from a
    cross join lateral (values
      (1, true, null::boolean, not (a.r2 or a.r3 or a.r4 or a.r5 or a.r6), null::numeric),
      (2, a.r2, true, not a.r2, case when a.r2 then extract(epoch from a.imported_at - a.created_at) end),
      (3, a.r3, a.r2, a.r2 and not a.r3, case when a.r3 then extract(epoch from a.master_at - a.created_at) end),
      (4, a.r4, a.r3, a.r3 and not a.r4, case when a.r4 then extract(epoch from a.tailored_at - a.created_at) end),
      (5, a.r5, a.r4, a.r4 and not a.r5, case when a.r5 then extract(epoch from a.exported_at - a.created_at) end),
      (6, a.r6, a.r5, a.r5 and not a.r6, case when a.r6 then extract(epoch from a.applied_at - a.created_at) end)
    ) v(step_order, reached, base, drop_flag, secs)
    where a.eligible
  ),
  agg as (
    select p.dim, p.step_order,
           count(*) filter (where p.reached) as n,
           count(*) filter (where p.base) as base_n,
           count(*) filter (where p.base and p.reached) as both_n,
           count(*) filter (where p.drop_flag) as n_dropped,
           percentile_cont(0.5) within group (order by p.secs) filter (where p.secs >= 0) as p50
    from per p
    group by p.dim, p.step_order
  ),
  tot as (
    select a.dim, count(*) filter (where a.eligible) as n_eligible, count(*) filter (where not a.eligible) as n_pending
    from a
    group by a.dim
  )
  select st.step_order, st.step, d.dim,
         coalesce(g.n, 0),
         case when st.step_order = 1 then null else round(g.both_n::numeric / nullif(g.base_n, 0), 4) end,
         round(coalesce(g.n, 0)::numeric / nullif(t.n_eligible, 0), 4),
         coalesce(g.n_dropped, 0),
         case when st.step_order = 1 then coalesce(t.n_pending, 0) end,
         round(g.p50::numeric, 0)
  from dims d
  cross join (values (1, 'signed_up'), (2, 'cv_imported'), (3, 'master_cv'), (4, 'tailored_cv'),
                     (5, 'exported'), (6, 'job_applied')) st(step_order, step)
  left join agg g on g.dim is not distinct from d.dim and g.step_order = st.step_order
  left join tot t on t.dim is not distinct from d.dim
  order by d.dim nulls first, st.step_order;
end $$;

comment on function analytics.activation_funnel(date, date, text, text, boolean, text, jsonb) is
'{"title":"Activation funnel","definition":"Signups of the range (UTC) whose 7-day window has closed, and the share that reached each milestone within 7 days of signup (the activation window of analytics.kpi_overview; recent signups are reported as pending on the signed_up row, never as failures). Steps: signed_up; cv_imported = an upload parsed successfully (parsed / reviewed / converted; dev mock parses excluded); master_cv = first master CV created; tailored_cv = first tailored CV created (deleted CVs count: the milestone happened); exported = first completed export, master or tailored (exported / signed_up equals kpi_overview''s activation_rate); job_applied = first move of a job to applied / interview / offer (applied_at or status history, else updated_at). users = signups reaching the step (each step on its own, so a CV started from scratch reaches master_cv without cv_imported). conversion_from_prev = share of the previous step''s users who also reached this step; conversion_from_start = users / eligible signups; dropped = users of the previous step who did not reach this one (signed_up: signups that reached no later step); median_seconds_from_signup is over the users reaching the step. Accounts pending deletion or restricted, and internal accounts unless included, are excluded; erased accounts are gone (survivorship). Market = the locked market (unknown without one); locale = the current UI locale; onboarding_path: upload = claimed a guest upload (from 2026-10-06), manual_create = counted manual signup (marker from 2026-10-26), else direct (so earlier manual signups and every signup before 2026-10-06 are direct). Grain and currency do not apply. Dashboard definition: steps within 7 days of signup for signups of the range (the KB counts ever-reached milestones per weekly cohort of the last 12 weeks), with the onboarding-completed step replaced by the CV import.","unit":"count","shape":"funnel","breakdowns":["market","locale","onboarding_path"],"filters":["market","locale","onboarding_path"],"kb":"queries/user_funnel_signup_to_application.md","consent_scoped":false,"alertable":false,"drill":true,"min_group":5,"measures":{"users":{"label":"Signups","unit":"count","description":"Eligible signups reaching the step within 7 days"},"conversion_from_prev":{"label":"Step conversion","unit":"ratio","description":"Of the previous step''s users"},"conversion_from_start":{"label":"Conversion from signup","unit":"ratio"},"dropped":{"label":"Dropped","unit":"count","description":"Reached the previous step but not this one"},"pending":{"label":"Window still open","unit":"count","description":"Signups less than 7 days old (not counted)"},"median_seconds_from_signup":{"label":"Median time from signup","unit":"seconds"}}}';

-- ---------------------------------------------------------------------------
-- analytics.onboarding_segments
-- ---------------------------------------------------------------------------

create function analytics.onboarding_segments(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, segment text, activation_rate numeric, users bigint, mature_7d bigint, master_7d_rate numeric,
  mature_14d bigint, subscribed_14d_rate numeric, paid_14d_rate numeric, median_seconds_to_first_export numeric,
  ai_cost_per_user numeric, ai_runs bigint, unpriced_runs bigint, consent_coverage numeric, fx_provisional boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_from date;
  v_markets text[];
  v_locales text[];
  v_paths text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'locale', 'onboarding_path']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  -- Onboarding answers exist from 2026-10-06.
  v_from := greatest(r.from_day, date '2026-10-06');
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_locales := analytics_private.filter_values(p_filters, 'locale');
  v_paths := analytics_private.filter_values(p_filters, 'onboarding_path');

  return query
  with base as (
    select u.id, u.created_at, u.analytics, op.onboarding_path,
           coalesce(nullif(u.onboarding_answers ->> 'goal', ''), '(none)') as goal,
           coalesce(nullif(u.onboarding_answers ->> 'career', ''), '(none)') as career,
           coalesce(nullif(u.onboarding_answers ->> 'education', ''), '(none)') as education
    from analytics_private.analysis_users u
    join analytics_private.user_onboarding_paths op on op.user_id = u.id
    left join public.billing_markets bm on bm.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and u.created_at >= analytics_private.utc_start(v_from)
      and u.created_at < analytics_private.utc_start(r.to_day + 1)
      and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
      and (v_paths is null or op.onboarding_path = any (v_paths))
  ),
  -- Answers are personal segments: only accounts with analytics consent are segmented.
  cohort as (
    select b.*,
           (b.created_at + interval '7 days' <= now()) as mature_7,
           (b.created_at + interval '14 days' <= now()) as mature_14,
           fm.at as first_master_at,
           fe.at as first_export_at,
           fs.at as first_sub_at,
           fp.at as first_paid_at
    from base b
    left join lateral (select min(m.created_at) as at from public.master_cvs m where m.user_id = b.id) fm on true
    left join lateral (
      select min(e.completed_at) as at from public.exports e where e.user_id = b.id and e.status = 'completed'
    ) fe on true
    -- First real subscription start (trial or paid); superseded rows kept: only the start date matters.
    left join lateral (
      select min(s.created_at) as at from public.subscriptions s
      where s.user_id = b.id and s.provider_subscription_id is not null and s.plan_code <> 'free'
        and s.status not in ('incomplete', 'incomplete_expired')
    ) fs on true
    -- First collected invoice with amount_paid > 0 (the $0 trial-start invoice is not a payment).
    left join lateral (
      select min(i.paid_at) as at from public.billing_invoices i
      where i.user_id = b.id and i.paid_at is not null and i.amount_paid > 0
        and i.status in ('paid', 'refunded', 'partially_refunded')
    ) fp on true
    where b.analytics
  ),
  -- AI cost to date per consenting user (non-mock runs, claimed guest parse runs included).
  ai as (
    select rc.user_id,
           count(*) as n_runs,
           sum(rc.cost_usd) as cost_usd,
           sum(rc.cost_usd * x.usd_try) as cost_try,
           count(*) filter (where rc.cost_usd is null and rc.has_tokens) as n_unpriced,
           coalesce(bool_or(p_currency = 'try' and rc.cost_usd is not null and x.usd_try is null), false) as missing_rate,
           coalesce(bool_or(p_currency = 'try' and rc.cost_usd is not null and x.provisional), false) as provisional
    from analytics_private.run_cost rc
    join cohort c on c.id = rc.user_id
    left join analytics_private.fx_months(date '2026-10-01', (now() at time zone 'UTC')::date) x
      on x.month = date_trunc('month', rc.started_at at time zone 'UTC')::date
    group by rc.user_id
  ),
  long as (
    select v.segment, v.label, c.*, a.n_runs, a.cost_usd, a.cost_try, a.n_unpriced, a.missing_rate, a.provisional
    from cohort c
    left join ai a on a.user_id = c.id
    cross join lateral (values
      ('all', 'all consenting signups'),
      ('path', 'path: ' || c.onboarding_path),
      ('goal', 'goal: ' || c.goal),
      ('career', 'career: ' || c.career),
      ('education', 'education: ' || c.education)
    ) v(segment, label)
  ),
  agg as (
    select l.label, l.segment,
           count(*) as n,
           count(*) filter (where l.mature_7) as n_m7,
           count(*) filter (where l.mature_7 and l.first_export_at < l.created_at + interval '7 days') as n_export7,
           count(*) filter (where l.mature_7 and l.first_master_at < l.created_at + interval '7 days') as n_master7,
           count(*) filter (where l.mature_14) as n_m14,
           count(*) filter (where l.mature_14 and l.first_sub_at < l.created_at + interval '14 days') as n_sub14,
           count(*) filter (where l.mature_14 and l.first_paid_at < l.created_at + interval '14 days') as n_paid14,
           percentile_cont(0.5) within group (order by extract(epoch from l.first_export_at - l.created_at)) as p50_export,
           coalesce(sum(l.n_runs), 0)::bigint as n_runs,
           coalesce(sum(l.n_unpriced), 0)::bigint as n_unpriced,
           sum(case when p_currency = 'try' then l.cost_try else l.cost_usd end) as cost,
           coalesce(bool_or(l.missing_rate), false) as missing_rate,
           coalesce(bool_or(l.provisional), false) as provisional
    from long l
    group by l.label, l.segment
  ),
  rows_ as (
    select * from agg
    union all
    select 'all consenting signups', 'all', 0, 0, 0, 0, 0, 0, 0, null::double precision, 0, 0, null::numeric, false, false
    where not exists (select 1 from agg)
  ),
  coverage as (
    select count(*) filter (where b.analytics)::numeric / nullif(count(*), 0) as share from base b
  )
  select x.label, x.segment,
         round(x.n_export7::numeric / nullif(x.n_m7, 0), 4),
         x.n,
         x.n_m7,
         round(x.n_master7::numeric / nullif(x.n_m7, 0), 4),
         x.n_m14,
         round(x.n_sub14::numeric / nullif(x.n_m14, 0), 4),
         round(x.n_paid14::numeric / nullif(x.n_m14, 0), 4),
         round(x.p50_export::numeric, 0),
         case when x.missing_rate or x.n = 0 then null else round(coalesce(x.cost, 0) / x.n, 6) end,
         x.n_runs,
         x.n_unpriced,
         case when x.segment = 'all' then round(cv.share, 4) end,
         x.provisional
  from rows_ x
  cross join coverage cv
  order by 3 desc nulls last, x.n desc, x.label;
end $$;

comment on function analytics.onboarding_segments(date, date, text, text, boolean, text, jsonb) is
'{"title":"Onboarding segments","definition":"Signups of the range (UTC, from 2026-10-06 when guest-upload onboarding and onboarding answers launched) with analytics consent, by onboarding segment (KB onboarding_segment_performance A-C): an all row, path (upload = claimed a guest upload, manual_create = counted manual signup, marker from 2026-10-26, else direct; so manual signups of 2026-10-06..25 read as direct), and the current goal / career / education answers ((none) = skipped, never asked or cleared; no history). Onboarding answers are personal segments, so only consenting accounts are segmented; consent_coverage (all row) = consenting / all signups in scope. activation_rate = first completed export within 7 days of signup and master_7d_rate = first master CV within 7 days, over signups whose 7-day window has closed (mature_7d); subscribed_14d_rate = first real subscription (trial or paid) within 14 days and paid_14d_rate = first collected invoice with amount_paid > 0 within 14 days, over mature_14d. median_seconds_to_first_export is over every exporter, uncapped. ai_cost_per_user = AI cost to date (exact + token-estimated; older cohorts have had longer to spend) / segment users, USD unless currency = try (converted per run month; fx_provisional when a rate is month-to-date, from an earlier month or missing, and then the cost is null); unpriced_runs make it a lower bound. The paywall launched on 2026-10-24, so subscription and export rates of earlier cohorts mix pre- and post-paywall behaviour. Accounts pending deletion or restricted, and internal accounts unless included, are excluded; erased accounts are gone (survivorship). Market = the locked market, locale = the current UI locale. Grain does not apply. Dashboard definition: one row per segment value (KB A-C as separate segments, not path x answer cross rows; the goal x career grid D and the anonymous funnel E-H are not ported); answers segmented for consenting users only.","unit":"ratio","shape":"breakdown","breakdowns":[],"filters":["market","locale","onboarding_path"],"kb":"new_analysis/acquisition/onboarding_segment_performance.md","consent_scoped":true,"alertable":false,"min_group":5,"measures":{"activation_rate":{"label":"Activation (export in 7 days)","unit":"ratio","description":"Over mature_7d"},"users":{"label":"Consenting signups","unit":"count"},"mature_7d":{"label":"7-day window closed","unit":"count"},"master_7d_rate":{"label":"Master CV in 7 days","unit":"ratio"},"mature_14d":{"label":"14-day window closed","unit":"count"},"subscribed_14d_rate":{"label":"Subscribed in 14 days","unit":"ratio","description":"Trial or paid subscription start"},"paid_14d_rate":{"label":"Paid in 14 days","unit":"ratio","description":"First collected invoice > 0"},"median_seconds_to_first_export":{"label":"Median time to first export","unit":"seconds"},"ai_cost_per_user":{"label":"AI cost per user","unit":"currency","description":"To date; USD unless currency = try"},"ai_runs":{"label":"AI runs","unit":"count"},"unpriced_runs":{"label":"Unpriced runs","unit":"count"},"consent_coverage":{"label":"Consent coverage","unit":"ratio","description":"Consenting / all signups in scope (all row)"}}}';

-- ---------------------------------------------------------------------------
-- analytics.import_quality
-- ---------------------------------------------------------------------------

create function analytics.import_quality(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, segment text, conversion_rate numeric, imports bigint, parsed bigint, failed bigint,
  stuck bigint, parse_success_rate numeric, converted bigint, median_seconds_to_master numeric,
  mature_7d bigint, export_7d_rate numeric, users bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_markets text[];
  v_locales text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_locales := analytics_private.filter_values(p_filters, 'locale');

  return query
  with imp as (
    select i.id, i.user_id, i.status, i.created_at, i.updated_at,
           (f.storage_path like 'guests/%') as from_guest,
           case lower(f.mime_type)
             when 'application/pdf' then 'pdf'
             when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
             when 'application/vnd.ms-word.document.macroenabled.12' then 'docm'
             when 'application/msword' then 'doc'
             when 'text/plain' then 'txt'
             when 'application/rtf' then 'rtf'
             when 'text/rtf' then 'rtf'
             else 'other' end as mime_group,
           case when i.parser_name is null then '(none)'
                when i.parser_name ~ '^(gemini|openai|anthropic|mock)_cv_parser_v1$' then 'ai'
                else 'heuristic' end as parser_kind,
           exists (select 1 from jsonb_array_elements_text(
                     case when jsonb_typeof(i.review_context -> 'warnings') = 'array'
                          then i.review_context -> 'warnings' else '[]'::jsonb end) w
                   where w like 'AI parser failed%') as ai_fallback,
           i.review_context -> 'diagnostics' ->> 'final_stage' as final_stage,
           i.review_context -> 'diagnostics' -> 'quality' ->> 'confidence' as confidence,
           case when jsonb_typeof(i.review_context -> 'diagnostics' -> 'quality' -> 'low_confidence') = 'boolean'
                then (i.review_context -> 'diagnostics' -> 'quality' ->> 'low_confidence') end as low_confidence,
           i.status in ('parsed', 'reviewed', 'converted') as is_parsed,
           -- Diagnostics exist from 2026-10-06 and are nulled on failure.
           (i.status in ('parsed', 'reviewed', 'converted')
            and i.created_at >= timestamptz '2026-10-06 00:00:00+00') as has_quality,
           (i.created_at + interval '7 days' <= now()) as mature,
           exists (select 1 from public.exports e
                   where e.user_id = i.user_id and e.status = 'completed'
                     and e.completed_at >= i.created_at
                     and e.completed_at < i.created_at + interval '7 days') as export_7d
    from public.imports i
    join public.files f on f.id = i.source_file_id
    join analytics_private.analysis_users u on u.id = i.user_id
    left join public.billing_markets bm on bm.user_id = i.user_id
    where i.parser_name is distinct from 'mock_cv_parser_v1'
      and (p_include_internal or not u.is_internal)
      and i.created_at >= analytics_private.utc_start(r.from_day)
      and i.created_at < analytics_private.utc_start(r.to_day + 1)
      and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  long as (
    select v.segment, v.label, i.*
    from imp i
    cross join lateral (values
      ('all', 'all imports', true),
      ('mime', 'mime: ' || i.mime_group, true),
      ('source', case when i.from_guest then 'source: guest_upload' else 'source: in_app_upload' end, true),
      ('parser', 'parser: ' || i.parser_kind || case when i.ai_fallback then ' (after AI fallback)' else '' end, i.has_quality),
      ('ai_fallback', case when i.ai_fallback then 'ai fallback: AI failed -> heuristic' else 'ai fallback: none' end, i.has_quality),
      ('final_stage', 'final stage: ' || coalesce(i.final_stage, '(unknown)'), i.has_quality),
      ('low_confidence', 'low confidence: ' || coalesce(i.low_confidence, '(unknown)'), i.has_quality),
      ('confidence', 'confidence: ' || coalesce(i.confidence, '(unknown)'), i.has_quality)
    ) v(segment, label, included)
    where v.included
  ),
  agg as (
    select l.label, l.segment,
           count(*) as n,
           count(*) filter (where l.is_parsed) as n_parsed,
           count(*) filter (where l.status = 'failed') as n_failed,
           count(*) filter (where l.status in ('uploaded', 'parsing') and l.updated_at < now() - interval '1 hour') as n_stuck,
           count(*) filter (where l.status = 'converted') as n_converted,
           percentile_cont(0.5) within group (order by extract(epoch from l.updated_at - l.created_at))
             filter (where l.status = 'converted') as p50_master,
           count(*) filter (where l.mature) as n_mature,
           count(*) filter (where l.mature and l.export_7d) as n_export,
           count(distinct l.user_id) as n_users
    from long l
    group by l.label, l.segment
  ),
  rows_ as (
    select * from agg
    union all
    select 'all imports', 'all', 0, 0, 0, 0, 0, null::double precision, 0, 0, 0 where not exists (select 1 from agg)
  )
  select x.label, x.segment,
         round(x.n_converted::numeric / nullif(x.n_parsed, 0), 4),
         x.n, x.n_parsed, x.n_failed, x.n_stuck,
         -- Quality segments hold successful parses only.
         case when x.segment in ('all', 'mime', 'source')
              then round(x.n_parsed::numeric / nullif(x.n_parsed + x.n_failed, 0), 4) end,
         x.n_converted,
         round(x.p50_master::numeric, 0),
         x.n_mature,
         round(x.n_export::numeric / nullif(x.n_mature, 0), 4),
         x.n_users
  from rows_ x
  order by 3 desc nulls last, x.n desc, x.label;
end $$;

comment on function analytics.import_quality(date, date, text, text, boolean, text, jsonb) is
'{"title":"Import quality","definition":"CV imports created in the range (UTC) by analysis accounts (KB import_quality_impact A and B, queries/cv_import_success_funnel), one row per segment value: all imports; mime (the browser-declared file type, grouped); source (claimed guest upload vs in-app upload); and the parse-quality segments parser (ai / heuristic, with AI fallback), ai_fallback (an ''AI parser failed'' warning: the heuristic result was kept), final_stage (extractor; pdf_ocr_tesseract / pdf_token_heuristic / utf8_decode are fallbacks), low_confidence and confidence. Quality segments come from review_context, which exists from 2026-10-06 and is nulled on failure, so they hold successful parses since 2026-10-06 only. parse_success_rate = parsed / (parsed + failed) for the all, mime and source rows (status is the latest state: a failed import re-parsed later counts as parsed); stuck = still uploaded / parsing an hour after the last update (not in the rate). conversion_rate = converted to a master CV / parsed; median_seconds_to_master = updated_at - created_at of converted imports (for guest claims created_at is the claim time, so it is understated). export_7d_rate = the same account completed any export within 7 days after the import, over imports at least 7 days old (mature_7d): user-level activation attributed to every import of that user. Dev mock parses, accounts pending deletion or restricted, and internal accounts unless included are excluded; erased accounts'' imports are gone (survivorship). Market = the locked market, locale = the current UI locale. Grain and currency do not apply. Dashboard definition: one range with every segment as rows instead of the KB''s per-month trend (C).","unit":"ratio","shape":"breakdown","breakdowns":[],"filters":["market","locale"],"kb":"new_analysis/acquisition/import_quality_impact.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"conversion_rate":{"label":"Converted to master CV","unit":"ratio","description":"Converted / parsed"},"imports":{"label":"Imports","unit":"count"},"parsed":{"label":"Parsed","unit":"count","description":"Parsed, reviewed or converted"},"failed":{"label":"Failed","unit":"count"},"stuck":{"label":"Stuck or abandoned","unit":"count","description":"Uploaded / parsing for over an hour"},"parse_success_rate":{"label":"Parse success","unit":"ratio","description":"Parsed / (parsed + failed); all, mime and source rows"},"converted":{"label":"Converted","unit":"count"},"median_seconds_to_master":{"label":"Median time to master CV","unit":"seconds"},"mature_7d":{"label":"Imports 7+ days old","unit":"count"},"export_7d_rate":{"label":"Export within 7 days","unit":"ratio","description":"Downstream activation"},"users":{"label":"Users","unit":"count"}}}';

-- ---------------------------------------------------------------------------
-- analytics.language_adoption
-- ---------------------------------------------------------------------------

create function analytics.language_adoption(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_currency text default 'usd', p_include_internal boolean default false,
  p_breakdown text default null, p_filters jsonb default '{}'::jsonb
)
returns table (
  dimension text, language_name text, cv_users bigint, user_share numeric, master_cvs bigint, tailored_cvs bigint,
  translation_runs bigint, translations_completed bigint, translations_failed bigint, translation_success_rate numeric,
  translations_applied bigint, translation_apply_rate numeric, translating_users bigint, translation_tokens bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_markets text[];
  v_locales text[];
begin
  perform analytics_private.assert_args(p_grain, p_currency, p_breakdown, p_filters,
    array[]::text[], array['market', 'locale']);
  select * into r from analytics_private.resolve_range(p_from, p_to);
  v_start := analytics_private.utc_start(r.from_day);
  v_end := analytics_private.utc_start(r.to_day + 1);
  v_markets := analytics_private.filter_values(p_filters, 'market');
  v_locales := analytics_private.filter_values(p_filters, 'locale');

  return query
  with people as (
    select u.id
    from analytics_private.analysis_users u
    left join public.billing_markets bm on bm.user_id = u.id
    where (p_include_internal or not u.is_internal)
      and (v_markets is null or coalesce(bm.market, 'unknown') = any (v_markets))
      and (v_locales is null or u.locale = any (v_locales))
  ),
  -- CV documents created in the range, by document language (deleted ones count: they were created).
  docs as (
    select lower(m.language) as lang, m.user_id, 'master' as kind
    from public.master_cvs m join people p on p.id = m.user_id
    where m.created_at >= v_start and m.created_at < v_end
    union all
    select lower(t.language), t.user_id, 'tailored'
    from public.tailored_cvs t join people p on p.id = t.user_id
    where t.created_at >= v_start and t.created_at < v_end
  ),
  -- cv_translate runs started in the range (non-mock); one row aggregates every per-block call.
  tr as (
    select coalesce(nullif(lower(ar.input_payload ->> 'target_language'), ''), '(unknown)') as lang,
           ar.user_id, ar.status, ar.total_tokens,
           coalesce(ar.status = 'completed' and (
             ar.output_payload ? 'applied_master_cv_id'
             or exists (select 1 from public.master_cvs m
                        where m.user_id = ar.user_id
                          and m.language = lower(ar.input_payload ->> 'target_language')
                          and m.created_at >= ar.completed_at
                          and m.created_at < ar.completed_at + interval '1 day')), false) as applied
    from public.ai_runs ar
    join people p on p.id = ar.user_id
    where ar.flow_type = 'cv_translate'
      and ar.provider <> 'mock'
      and ar.started_at >= v_start and ar.started_at < v_end
  ),
  doc_agg as (
    select d.lang,
           count(distinct d.user_id) as n_users,
           count(*) filter (where d.kind = 'master') as n_master,
           count(*) filter (where d.kind = 'tailored') as n_tailored
    from docs d
    group by d.lang
  ),
  tr_agg as (
    select t.lang,
           count(*) as n_runs,
           count(*) filter (where t.status = 'completed') as n_completed,
           count(*) filter (where t.status = 'failed') as n_failed,
           count(*) filter (where t.applied) as n_applied,
           count(distinct t.user_id) as n_users,
           sum(t.total_tokens) as tokens
    from tr t
    group by t.lang
  ),
  langs as (
    select lang from doc_agg union select lang from tr_agg
  ),
  tot as (select count(distinct d.user_id) as n from docs d)
  select l.lang,
         coalesce(cl.name, '(not in catalog)'),
         coalesce(da.n_users, 0),
         round(coalesce(da.n_users, 0)::numeric / nullif(t.n, 0), 4),
         coalesce(da.n_master, 0),
         coalesce(da.n_tailored, 0),
         coalesce(ta.n_runs, 0),
         coalesce(ta.n_completed, 0),
         coalesce(ta.n_failed, 0),
         round(ta.n_completed::numeric / nullif(ta.n_completed + ta.n_failed, 0), 4),
         coalesce(ta.n_applied, 0),
         round(ta.n_applied::numeric / nullif(ta.n_completed, 0), 4),
         coalesce(ta.n_users, 0),
         coalesce(ta.tokens, 0)::bigint
  from langs l
  cross join tot t
  left join doc_agg da on da.lang = l.lang
  left join tr_agg ta on ta.lang = l.lang
  left join public.cv_languages cl on cl.code = l.lang
  order by 3 desc, 7 desc, l.lang;
end $$;

comment on function analytics.language_adoption(date, date, text, text, boolean, text, jsonb) is
'{"title":"CV languages and translation","definition":"CV document languages and CV translation per language for the range (UTC) (KB translation_and_language_adoption A, C, D). cv_users = accounts that created a master or tailored CV in that document language in the range (deleted CVs count; an account can count in several languages), user_share = of accounts creating any CV in the range; master_cvs / tailored_cvs = CVs created. Translation (cv_translate, from 2026-10-12; one run aggregates every per-block call) by target language: runs started in the range, completed, failed, translation_success_rate = completed / (completed + failed) (pending runs, including translations the client never executed, stay out), translations_applied = completed runs whose result was saved (replaced an existing master, or a heuristic: a master in the target language created by the same account within a day after completion), translation_apply_rate = applied / completed, translating_users, translation_tokens (cv_translate has no stored cost and the heavy models have no price, so tokens are the cost proxy). Target ''(unknown)'' = payload wiped by a privacy action; ''(not in catalog)'' = a code not in cv_languages. Mock runs, accounts pending deletion or restricted, and internal accounts unless included are excluded; erased accounts are gone (survivorship). Market = the locked market, locale = the current UI locale (use them as filters for the CV language vs locale vs market view). Grain and currency do not apply. Dashboard definition: CV creation in the range instead of the KB''s snapshot of live masters; the pre/post paywall split (B) and translation directions (E) are not ported.","unit":"count","shape":"breakdown","breakdowns":[],"filters":["market","locale"],"kb":"new_analysis/acquisition/translation_and_language_adoption.md","consent_scoped":false,"alertable":false,"min_group":5,"measures":{"cv_users":{"label":"Users creating CVs","unit":"count"},"user_share":{"label":"Share of CV creators","unit":"ratio"},"master_cvs":{"label":"Master CVs created","unit":"count"},"tailored_cvs":{"label":"Tailored CVs created","unit":"count"},"translation_runs":{"label":"Translations","unit":"count","description":"cv_translate runs into the language"},"translations_completed":{"label":"Completed translations","unit":"count"},"translations_failed":{"label":"Failed translations","unit":"count"},"translation_success_rate":{"label":"Translation success","unit":"ratio","description":"completed / (completed + failed)"},"translations_applied":{"label":"Applied translations","unit":"count"},"translation_apply_rate":{"label":"Apply rate","unit":"ratio","description":"applied / completed"},"translating_users":{"label":"Translating users","unit":"count"},"translation_tokens":{"label":"Translation tokens","unit":"tokens"}}}';

-- ---------------------------------------------------------------------------
-- Drill-down keys (analytics_people.drill_users -> analytics_private.drill_<key>)
-- Each returns every user behind the point, one row per user; drill_users applies the privacy rules and
-- include_internal, then pages by sort_key desc, user_id.
-- ---------------------------------------------------------------------------

-- Accounts behind a tailoring_funnel point: with step, the sessions that reached the step's base but not the step
-- (its dropped column); without step (or session_started), failed or abandoned sessions.
create function analytics_private.drill_tailoring_failed_sessions(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_step text;
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'locale', 'step']);
  if p_filters ? 'step' then
    if jsonb_typeof(p_filters -> 'step') <> 'string' or (p_filters ->> 'step') not in
       ('session_started', 'analysed', 'passed_questions', 'finished', 'exported', 'applied', 'interview_or_offer') then
      raise exception 'unsupported step' using errcode = '22023';
    end if;
    v_step := p_filters ->> 'step';
  end if;
  return query
  with s as (
    -- Internal accounts are kept: drill_users applies include_internal and the privacy rules.
    select x.*,
           (x.errored or x.failed_tasks > 0 or (not x.finished and x.created_at < now() - interval '24 hours')) as bad
    from analytics_private.tailoring_v2_session_steps(p_from, p_to, true, p_filters - 'step') x
  ),
  hit as (
    select s.* from s
    where case coalesce(v_step, 'session_started')
            when 'session_started' then s.bad
            when 'analysed' then not s.analysed
            when 'passed_questions' then s.has_questions and not s.passed_questions
            when 'finished' then s.analysed and not s.finished
            when 'exported' then s.finished and not s.exported
            when 'applied' then s.finished and s.exported and not s.applied
            else s.finished and s.exported and s.applied and not s.interview_or_offer
          end
  )
  select h.user_id,
         count(*)::numeric,
         jsonb_build_object(
           'sessions', count(*),
           'errored_sessions', count(*) filter (where h.errored),
           'sessions_with_failed_tasks', count(*) filter (where h.failed_tasks > 0),
           'failed_tasks', sum(h.failed_tasks),
           'unfinished_sessions', count(*) filter (where not h.finished),
           'last_session_at', max(h.created_at),
           'last_step', (array_agg(h.last_step order by h.created_at desc, h.session_id))[1],
           'market', min(h.market),
           'locale', min(h.locale)),
         count(*)::text
  from hit h
  group by h.user_id;
end $$;

comment on function analytics_private.drill_tailoring_failed_sessions(date, date, jsonb, integer, text) is
'{"description":"Accounts with tailoring v2 sessions created in the range that dropped out (analytics.tailoring_funnel population), most sessions first. step = a funnel step lists the sessions in that step''s base that did not reach it (its dropped column); no step or session_started lists failed or abandoned sessions: an error, a failed task, or not finished 24 hours after creation.","metric":"tailoring_funnel","filters":["market","locale","step"],"value":"matching sessions in range","unit":"count","order":"most sessions first","detail":["sessions","errored_sessions","sessions_with_failed_tasks","failed_tasks","unfinished_sessions","last_session_at","last_step","market","locale"]}';

-- Accounts behind an activation_funnel point: eligible signups of the range in the step's dropped column.
create function analytics_private.drill_activation_dropoff(p_from date, p_to date, p_filters jsonb, p_limit integer, p_cursor text)
returns table (user_id uuid, value numeric, detail jsonb, sort_key text)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_step text;
begin
  perform analytics_private.assert_filter_keys(p_filters, array['market', 'locale', 'onboarding_path', 'step']);
  if jsonb_typeof(p_filters -> 'step') is distinct from 'string' or (p_filters ->> 'step') not in
     ('signed_up', 'cv_imported', 'master_cv', 'tailored_cv', 'exported', 'job_applied') then
    raise exception 'filters.step is required: one of signed_up, cv_imported, master_cv, tailored_cv, exported, job_applied'
      using errcode = '22023';
  end if;
  v_step := p_filters ->> 'step';
  return query
  with a as (
    select x.*,
           coalesce(x.imported_at < x.created_at + interval '7 days', false) as r2,
           coalesce(x.master_at < x.created_at + interval '7 days', false) as r3,
           coalesce(x.tailored_at < x.created_at + interval '7 days', false) as r4,
           coalesce(x.exported_at < x.created_at + interval '7 days', false) as r5,
           coalesce(x.applied_at < x.created_at + interval '7 days', false) as r6
    from analytics_private.signup_activation(p_from, p_to, true, p_filters - 'step') x
    where x.eligible
  )
  select a.user_id,
         1::numeric,
         jsonb_build_object(
           'created_at', a.created_at, 'market', a.market, 'locale', a.locale, 'onboarding_path', a.onboarding_path,
           'cv_imported_7d', a.r2, 'master_cv_7d', a.r3, 'tailored_cv_7d', a.r4, 'exported_7d', a.r5, 'job_applied_7d', a.r6,
           'first_import_at', a.imported_at, 'first_master_cv_at', a.master_at, 'first_tailored_cv_at', a.tailored_at,
           'first_export_at', a.exported_at, 'first_applied_at', a.applied_at),
         floor(extract(epoch from a.created_at) * 1000000)::text
  from a
  where case v_step
          when 'signed_up' then not (a.r2 or a.r3 or a.r4 or a.r5 or a.r6)
          when 'cv_imported' then not a.r2
          when 'master_cv' then a.r2 and not a.r3
          when 'tailored_cv' then a.r3 and not a.r4
          when 'exported' then a.r4 and not a.r5
          else a.r5 and not a.r6
        end;
end $$;

comment on function analytics_private.drill_activation_dropoff(date, date, jsonb, integer, text) is
'{"description":"Signups of the range whose 7-day window has closed and who dropped at a funnel step (analytics.activation_funnel dropped column), newest signup first. step (required): signed_up = reached no later milestone within 7 days; cv_imported = no successful import; master_cv / tailored_cv / exported / job_applied = reached the previous step but not this one within 7 days.","metric":"activation_funnel","filters":["market","locale","onboarding_path","step"],"value":"1 per account","unit":"count","order":"newest signup first","detail":["created_at","market","locale","onboarding_path","cv_imported_7d","master_cv_7d","tailored_cv_7d","exported_7d","job_applied_7d","first_import_at","first_master_cv_at","first_tailored_cv_at","first_export_at","first_applied_at"]}';

select analytics_private.refresh_drill_metrics();

revoke execute on all functions in schema analytics, analytics_people, analytics_private, admin_app from public;
