-- CV review v2 scores a guest upload with a second AI run (cv_review) on the same lease.
-- Guest runs were limited to one cv_parse per lease, so the review was always rejected and
-- every pre-signup upload fell back to the basic score. Allow one run per flow instead.
begin;

alter table public.ai_runs drop constraint ai_runs_subject_check;
alter table public.ai_runs add constraint ai_runs_subject_check check (
  (user_id is not null and guest_import_id is null and guest_lease_id is null)
  or (user_id is null and guest_import_id is not null and guest_lease_id is not null
      and flow_type in ('cv_parse','cv_review') and master_cv_id is null and tailored_cv_id is null and job_id is null and import_id is null)
);

drop index public.ai_runs_guest_lease_idx;
create unique index ai_runs_guest_lease_idx on public.ai_runs(guest_import_id,guest_lease_id,flow_type) where guest_import_id is not null;

commit;
