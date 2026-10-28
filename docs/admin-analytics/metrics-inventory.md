# Admin Analytics — Deployed metrics inventory

The SQL functions in production as of **2026-10-28**, after migrations up to `20261104120000_analytics_alerts.sql`. This file is the authoritative list of names and output columns. [metrics-plan.md](metrics-plan.md) is the original plan; names and columns changed during the build.

- **Definitions** (what each number means, deviations from the KB) live in each function's `comment on function` (`meta.definition`). They are shown in the app's info popover and in the KB file named under `kb`.
- **Contract** (signature, meta keys, shapes, currency rules): [api-contract.md](api-contract.md).
- **Columns:** `bucket`, `dimension`, `step_order`, `step`, `cohort` and `period` are layout columns; every other numeric column is a measure. A **bold** column is the primary measure: the column named like the metric, else the first measure column.

## Regenerate this file
Run in the Supabase SQL editor (read-only):
```sql
select c.kind, c.name, c.meta->>'shape' shape, c.meta->>'unit' unit,
       c.meta->'breakdowns' breakdowns, c.meta->'filters' filters,
       c.meta->>'drill' drill, c.meta->>'precomputed' precomputed, c.meta->>'alertable' alertable,
       c.meta->>'consent_scoped' consent, c.meta->>'kb' kb,
       (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = case c.kind when 'metric' then 'analytics' else 'analytics_people' end and p.proname = c.name) returns
from admin_app.metric_catalog() c order by c.kind, c.name;
select key, meta->>'metric' metric, meta->'filters' filters, description from admin_app.drill_keys() order by key;
```

## Metrics by admin page
Page layout lives in `admin/src/app/pages.ts`; Overview is `admin/src/pages/Overview.tsx`.

**Flags:**
- **D:** `drill: true`. Clicking a point opens the users drawer.
- **P:** `precomputed`, read from a materialized view. These have the Recompute button.
- **A:** `alertable`. Can be used in alert rules.
- **C:** `consent_scoped`. Analytics-consenting users only.

**Breakdowns / filters:** a single list means the breakdowns and the filters are the same; `–` = none; `+ x` = the breakdowns plus `x`.

### Overview
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `kpi_overview` | kpi | – / market, plan | A | signups, activated_users, activation_eligible, activated_eligible, activation_rate, new_paying_customers, revenue, revenue_usd_native, revenue_try_native, mrr, mrr_usd_native, mrr_try_native, active_subscriptions, trial_starts, trial_resolved, trial_conversions, trial_to_paid_rate, ai_cost, ai_runs, unpriced_ai_runs, revenue_fx_provisional, mrr_fx_provisional, ai_cost_fx_provisional |
| `signups` | timeseries | locale, market / same | D | **signups** |
| `revenue` | timeseries | market, plan / market, plan, currency | – | **revenue**, refunded, invoices, fx_provisional |
| `ai_cost` | timeseries | ai_flow, ai_model, ai_provider / same | D | **cost**, runs, unpriced_runs, exact_share, fx_provisional |

### Monetization
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `revenue` | timeseries | see Overview | – | – (card option `native: "split"`) |
| `mrr_movement` | timeseries (stacked) | market, plan / market, plan, currency | – | new, expansion, contraction (−), churn (−), reactivation, fx_effect, starting_mrr, ending_mrr, starting_customers, new_customers, reactivated_customers, churned_customers, ending_customers, fx_provisional. Day grain ≤ 366 days. |
| `plan_mix` | breakdown | plan / market, plan, currency | – | subscriptions, share, mrr, mrr_usd_native, mrr_try_native, switched_in, switched_out, fx_provisional |
| `subscriber_ltv` | breakdown | plan, market, currency | – | **ltv**, customers, ltv_usd_native, ltv_try_native, median_ltv, revenue(+natives), still_paying, censored_share, avg_paid_invoices, avg_observed_months, erased_customers, fx_provisional |
| `trial_to_paid` | timeseries | market, plan | D | **trial_to_paid**, trial_starts, converted, failed_first_charge, trial_canceled, superseded, in_trial, unresolved, resolved, failed_charge_rate |
| `paywall_denials` | timeseries | market, plan | D C | user_days, users, hits, hits_consenting, hits_anonymous, anonymous_share |
| `checkout_funnel` | funnel | market, plan | D | step_order, step (`attempts`, `session_created`, `completed`, `paid_within_7d`), users, conversion_from_prev, conversion_from_start, dropped, pending |
| `subscription_churn` | timeseries (stacked) | market, plan | D | paid_churn, paid_voluntary, paid_involuntary, paid_other_or_unknown, ended_never_paid, replaced_excluded, cancel_scheduled_open, lost_to_erasure, lost_mrr(+natives), involuntary_share, fx_provisional |
| `payment_issues` | timeseries | market, plan / + currency | – | failed_invoices, invoices_due, failure_rate, paid_late_invoices, failed_amount(+natives), past_due/recovered/lost_episodes, refunded_invoices, refunded(+natives), refund_rate, discounted_invoices, discount(+natives), effective_discount_rate, fx_provisional |
| `cancellation_reasons` | breakdown | – / market, plan | – | cancellations, share, reason_group_share, paid_cancellations, trial_or_unpaid_cancellations, reason_group, cancellation_reason, cancellation_feedback |

### AI cost
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `ai_cost` | timeseries | see Overview | D | – |
| `ai_cost_anomalies` | timeseries (`flag_column: is_anomaly`) | ai_flow, ai_model, ai_provider / + market | – | cost, runs, tokens, unpriced_runs, terminal_runs, model_failed_runs, model_failure_rate, cost_baseline, cost_upper_band, cost_z, tokens_baseline, tokens_upper_band, tokens_z, baseline_buckets, cost_spike, token_spike, jump_from_flat_baseline, failure_spike, is_anomaly, fx_provisional |
| `ai_tokens_by_model` | timeseries (stacked) | ai_model, ai_provider, ai_flow / + market | – | total_tokens, input_tokens, cached_input_tokens, output_tokens, runs, runs_without_tokens, completed_runs, failed_runs, cost, unpriced_runs, fx_provisional |
| `ai_wasted_spend` | timeseries | ai_flow, ai_model, ai_provider / + market | D | wasted_share, wasted_cost, total_cost, failed_runs_cost, expired_cards_cost, rejected_cards_cost, unfinished_sessions_cost, failed_import_improve_cost, skills_pool_escalation_cost, wasted_tokens_share, runs, failed_runs, unpriced_runs, fx_provisional |
| `ai_cost_per_outcome` | breakdown | – / ai_model, ai_provider, market | – | **cost_per_outcome**, outcomes, users, attributed_cost(+exact/estimated), attributed_runs, unpriced_runs, tokens_per_outcome, fully_loaded_cost_per_outcome, fx_provisional |
| `ai_cost_by_plan` | breakdown (segments) | – / plan, market | – | **ai_cost**, users, paying_users, ai_active_users, runs, unpriced_runs, cost_per_user, cost_per_paying_user, revenue(+natives), ai_cost_share_of_revenue, gross_margin, exact_share, fx_provisional |
| `ai_cost_concentration` | breakdown (deciles; deciles with < 2 users are nulled) | – / ai_flow, ai_model, ai_provider, market | – | cost_share, cumulative_cost_share, cost, users, runs, tokens, token_share, unpriced_runs, gini_cost, gini_tokens, fx_provisional |
| `ai_reliability` | timeseries | ai_flow, ai_model, ai_provider / + market | D | failure_rate, runs, completed_runs, failed_runs, pending_runs, model_failure_rate, model_failed_runs, p50_duration_seconds, p95_duration_seconds, avg_tokens_per_run |

### Engagement
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `active_users` | timeseries | market, locale | – | **active_users**, ai_active_users, exporting_users, tailoring_users, events. Day = DAU, week = WAU, month = MAU. |
| `stickiness` | timeseries (`flag_column: partial`) | market | C | **stickiness**, dau, wau, mau, active_users, partial. Data starts 2026-10-29. |
| `cohort_retention` | cohort | – / market, locale | D P | cohort, period, cohort_size, active, rate, is_partial_period |
| `growth_accounting` | timeseries (stacked, `flag_column: is_partial_period`) | market, locale | D P | new_users, retained_users, resurrected_users, churned_users (−), active_users, net_change, quick_ratio, retention_rate, is_partial_period |
| `feature_adoption` | breakdown | – / market, locale | D | users, share_of_active, events, success_rate, active_users |

### Tailoring
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `tailoring_funnel` | funnel | market, locale | D | steps `session_started → analysed → passed_questions → finished → exported → applied → interview_or_offer`; users (= sessions), conversion_from_prev, conversion_from_start, dropped, distinct_users, timed_sessions, median_seconds_from_prev, p90_seconds_from_prev |
| `tailoring_task_reliability` | timeseries | ai_model, ai_provider, market, locale | – | task_failure_rate, tasks, done/skipped/failed/open_tasks, block/summary/skills/structure_failure_rate, avg_attempts, rerun_share, done_without_card_share, p50/p95_task_seconds, run_failure_rate, runs, failed_runs |
| `tailoring_card_acceptance` | breakdown (mixed drivers) | – / ai_model, ai_provider, market, locale | – | driver, **acceptance_rate**, cards, decided, applied, rejected, pending, expired, applied/rejected/expired/pending/edited_share, sessions, users |
| `tailoring_questions` | breakdown | – / market, locale | – | answer_rate, questions, answered, skipped_or_empty, never_touched, sessions, sessions_with_kind, session_share, avg/max_per_session, gap_yes/some/no, users |

### Acquisition
| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `signups` | timeseries | see Overview | D | – |
| `activation_funnel` | funnel | market, locale, onboarding_path | D | steps `signed_up → cv_imported → master_cv → tailored_cv → exported → job_applied` (7-day windows; exported / signed_up = Overview activation rate); users, conversion_from_prev/start, dropped, pending, median_seconds_from_signup |
| `onboarding_segments` | breakdown (mixed segments) | – / market, locale, onboarding_path | C | segment, **activation_rate**, users, mature_7d, master_7d_rate, mature_14d, subscribed_14d_rate, paid_14d_rate, median_seconds_to_first_export, ai_cost_per_user, ai_runs, unpriced_runs, consent_coverage, fx_provisional |
| `import_quality` | breakdown (mixed segments) | – / market, locale | – | segment, **conversion_rate**, imports, parsed, failed, stuck, parse_success_rate, converted, median_seconds_to_master, mature_7d, export_7d_rate, users |
| `language_adoption` | breakdown | – / market, locale | – | language_name, cv_users, user_share, master_cvs, tailored_cvs, translation_runs, translations_completed/failed, translation_success_rate, translations_applied, translation_apply_rate, translating_users, translation_tokens |

### Alerts and Data health
`kpi_health` is not drawn as a card; it is offered only as an alert-rule target on Alerts. `data_freshness` is the checks list on Data health.

| Function | Shape | Breakdowns / filters | Flags | Columns |
|---|---|---|---|---|
| `kpi_health` | kpi | – / market, plan (plan applies to payments and checkout only) | A | ai_runs, ai_failed_runs, ai_failure_rate, failed_payments, payment_failure_rate, checkout_attempts, checkout_abandon_rate, export_failures, export_failure_rate, import_failures, import_failure_rate, tailoring_task_failures, tailoring_task_failure_rate, unpriced_ai_runs |
| `data_freshness` | table | none | – | item, label, status (`ok`/`warn`/`error`/`info`), value, value_text, at, detail. Items: nightly_refresh, last_recompute, pending_recompute, precomputed_as_of, scheduler, alerts_evaluated, fx_latest_month, billing_price_catalog, billing_plan_catalog, ai_model_prices, unpriced_ai_runs_30d, contract_violations |

## People functions (`analytics_people`, audited, `POST /admin/people/:name`)
| Function | Columns |
|---|---|
| `search_users` | user_id, email, created_at, market, plan_code, subscription_status, analytics_consent, is_internal, restricted, cursor |
| `user_summary` | user_id, email, created_at, locale, market, is_internal, analytics_consent, ai_consent, plan_code, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, usage (`{counter: {used, limit}}`), entitlement_denials, invoices, paid_usd_native, paid_try_native, last_activity_at, restricted |
| `user_timeline` | occurred_at, event_type, entity, entity_id, status, is_failure, duration_ms, detail, error_code, error_message (allow-listed), cursor. The event types are listed in api-contract.md (Phase 2). |
| `drill_users` | user_id, email, value, detail, cursor. Needs `filters.metric` = a drill key below. |

## Drill keys (`analytics_private.drill_<key>`, dispatched by `drill_users`)
| Key | Drills metric | Filters |
|---|---|---|
| `signups` | signups | locale, market |
| `ai_cost_users` | ai_cost | ai_flow, ai_model, ai_provider |
| `ai_failures` | – (generic) | ai_flow, ai_model, ai_provider |
| `ai_failures_by_flow` | ai_reliability | ai_flow, ai_model, ai_provider, market |
| `ai_wasted_spend` | ai_wasted_spend | ai_flow, ai_model, ai_provider, market |
| `trial_conversions` | trial_to_paid | market, plan, outcome |
| `checkout_funnel` | checkout_funnel | market, plan, step |
| `checkout_abandoned` | – (generic) | market, plan |
| `churned_subscribers` | subscription_churn | market, plan, reason_group |
| `paywall_denials` | paywall_denials | market, plan |
| `churned_users` | growth_accounting | grain, market, locale |
| `cohort_active_users` | cohort_retention | cohort, period, grain, market, locale |
| `feature_users` | feature_adoption | dimension, market, locale |
| `tailoring_failed_sessions` | tailoring_funnel | market, locale, step |
| `activation_dropoff` | activation_funnel | market, locale, onboarding_path, step |

`drill_users` also accepts `day` and `include_internal`. The UI picks the key whose `metric` matches the clicked chart, using `drill_metrics` in the `drill_users` catalog entry. The drawer sends the clicked range as `from`/`to` and never sends `day`, `include_internal` (so drill lists always exclude internal accounts), `outcome` or `reason_group`; those are API-only.
