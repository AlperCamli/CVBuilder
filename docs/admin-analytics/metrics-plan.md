# Admin Analytics — Metrics plan (v1)

> **Historical:** this is the original build plan. Several names and columns changed during the build; see [metrics-inventory.md](metrics-inventory.md) for what is deployed.

Every dashboard number is one SQL function (see [api-contract.md](api-contract.md)). This file lists them by phase with their KB source, so porting stays traceable.

KB root: `/Users/alpercamli/Desktop/cv-data-model-kb/CV_data_tool`.
- Conventions: `new_analysis/README.md`, covering standard filters, era cutoffs, AI cost, and revenue in three currency variants.
- Table docs: `tables/*.md`.
- When a ported function changes how a number is computed, update the KB file and add a `Dashboard function:` line to it.

## Row shapes (`meta.shape`)

| Shape | Columns | Rendered as |
|---|---|---|
| `timeseries` | `bucket date, dimension text, <measures…>`. The first measure is the primary one. `dimension` is null unless a breakdown is requested. | Line or bar over time |
| `kpi` | One row of named measures for the whole range | KPI tiles; the UI calls it again for the previous window |
| `breakdown` | `dimension text, <measures…>`, sorted by the primary measure, descending | Horizontal bars plus a table |
| `funnel` | `step_order int, step text, users bigint, conversion_from_prev numeric, conversion_from_start numeric`, with an optional `dimension text` | Funnel bars |
| `cohort` | `cohort date, period int, cohort_size bigint, active bigint, rate numeric` | Heatmap |
| `table` | Free columns | Table |

**Units:**
- `percent` and `ratio` measures are 0–1 fractions.
- `currency` measures are major units, in the requested currency variant.

**Currency rules:**
- With `p_currency = 'native'`, revenue functions split by invoice currency. They use `dimension` for the currency, and no other breakdown is allowed in that mode.
- With `usd` or `try`, everything is converted using the monthly `fx_rates`. A boolean `fx_provisional` column says whether any non-final rate was used.
- AI cost is USD by nature. `native` behaves like `usd`, and `try` converts.

## Shared definitions (Phase 1, `analytics_private`)

| Object | Definition (KB `new_analysis/README.md`) |
|---|---|
| `internal_users` (view) | `users.is_internal`. Admin flagging is case-insensitive via `public.mark_internal_users`. |
| `analysis_users` (view, exists) | Users not pending deletion and not restricted |
| `invoice_revenue` (view) | The KB `invoice_revenue` CTE, plus `revenue_usd`, `revenue_try`, `usd_try`, `fx_is_final` from a monthly FX lateral, and `is_internal_user`. Erased users (`user_id` null) count. |
| `run_cost` (view) | The KB `run_cost` CTE, with prices from `public.ai_model_prices` instead of the hard-coded CTE. Excludes `provider = 'mock'`. Adds `cost_usd`, `cost_is_exact`, `is_priced`, `is_internal_user`. |
| `public.ai_model_prices` (table) | `model_prefix` pk, `input_usd`, `cached_input_usd`, `output_usd`, `refreshed_at`. Filled by the 03:30 refresh from `AI_MODEL_PRICING_JSON`. Longest prefix match. |

## Phase 1: Overview
| Function | Shape | KB source |
|---|---|---|
| `signups` (exists) | timeseries | `queries/monthly_new_signups.md` |
| `kpi_overview` | kpi | Signups, activated users and activation rate, new paying customers, revenue (all three variants), MRR and active subscriptions at the end of the range, trial→paid rate, AI cost, unpriced AI runs, `fx_provisional`. Sources: `user_acquisition_activation_report`, `new_paying_customers_monthly`, `revenue_monthly_by_currency`, `mrr_movement_waterfall`, `active_subscriptions_by_plan`, `trial_to_paid_conversion`, `ai_cost_per_outcome` |
| `revenue` | timeseries | `new_analysis/monetization/revenue_monthly_by_currency.md`; breakdowns market, plan |
| `ai_cost` | timeseries | `new_analysis/ai_cost/*` (run_cost); breakdowns ai_flow, ai_model, ai_provider |

## Phase 2: Users (`analytics_people`, audited)
| Function | Notes |
|---|---|
| `search_users` | Matches email (case-insensitive prefix/contains) or exact user id. Returns id, email, signup date, market, plan, status, consent flags. At most `p_limit` rows. |
| `user_summary` | Account summary for FR4 |
| `user_timeline` | `queries/user_activity_timeline.md`, extended with tailoring sessions/tasks, checkout attempts, subscription events, invoices, entitlement denials and CV languages. Metadata only: no CV, job or AI content. Keyset-paginated. |
| `drill_users` | The users behind a metric point: `p_filters.metric` plus dimension values and the date range. Populated per metric in Phases 3–4. |

## Phase 3: Monetization and AI cost
| Function | Shape | KB source |
|---|---|---|
| `mrr_movement` | timeseries (new / expansion / contraction / churn / reactivation) | `monetization/mrr_movement_waterfall.md` |
| `trial_to_paid` | timeseries by trial-start cohort | `monetization/trial_to_paid_conversion.md` |
| `checkout_funnel` | funnel | `monetization/checkout_funnel_abandonment.md` |
| `subscriber_ltv` | breakdown by plan/market | `monetization/subscriber_ltv.md` |
| `plan_mix` | breakdown | `monetization/plan_mix_and_switching.md`, `queries/active_subscriptions_by_plan.md` |
| `subscription_churn` | timeseries | `queries/subscription_churn_monthly.md` |
| `payment_issues` | timeseries (failures, refunds, discounts) | `monetization/payment_failures_refunds_discounts.md` |
| `cancellation_reasons` | breakdown | `monetization/cancellation_reasons.md` |
| `paywall_denials` | timeseries, consent-scoped | `monetization/paywall_transition_impact.md` |
| `ai_cost_per_outcome` | breakdown by flow | `ai_cost/ai_cost_per_outcome.md` |
| `ai_reliability` | timeseries (runs, failure rate, p95 duration) | `queries/ai_flow_efficiency_and_failure_rate.md` |
| `ai_wasted_spend` | timeseries | `ai_cost/ai_wasted_spend.md` |
| `ai_cost_anomalies` | timeseries with an anomaly flag | `ai_cost/ai_daily_cost_anomalies.md` |
| `ai_cost_by_plan` | breakdown | `ai_cost/ai_cost_unit_economics_by_plan.md` |
| `ai_cost_concentration` | breakdown (cost share by user decile) | `ai_cost/ai_cost_concentration.md` |
| `ai_tokens_by_model` | timeseries | `queries/ai_token_usage_monthly_by_model.md` |

## Phase 4: Engagement, Tailoring and Acquisition (heavy ones as materialized views)
| Function | Shape | KB source |
|---|---|---|
| `active_users` | timeseries | `queries/monthly_active_users.md` |
| `stickiness` | timeseries (DAU, WAU, MAU, DAU/MAU), consent-scoped | `customer_behavior/engagement_stickiness_dau_wau_mau.md` |
| `cohort_retention` | cohort (MV) | `customer_behavior/cohort_retention_triangle.md` |
| `growth_accounting` | timeseries (MV) | `customer_behavior/weekly_growth_accounting.md` |
| `feature_adoption` | breakdown | `queries/cover_letter_adoption.md`, `export_volume_and_success_by_format.md`, `template_popularity.md` |
| `tailoring_funnel` | funnel plus median step timing | `tailoring/tailoring_session_funnel_timing.md` |
| `tailoring_task_reliability` | timeseries | `tailoring/tailoring_task_reliability.md` |
| `tailoring_card_acceptance` | breakdown | `tailoring/tailoring_card_acceptance_drivers.md` |
| `tailoring_questions` | breakdown | `tailoring/tailoring_question_engagement.md` |
| `activation_funnel` | funnel | `queries/user_funnel_signup_to_application.md`, `user_acquisition_activation_report.md` |
| `onboarding_segments` | breakdown, consent-scoped | `acquisition/onboarding_segment_performance.md` |
| `import_quality` | breakdown | `acquisition/import_quality_impact.md`, `queries/cv_import_success_funnel.md` |
| `language_adoption` | breakdown | `acquisition/translation_and_language_adoption.md` |

## Phase 5: Data health and alerts
| Function | Shape | Notes |
|---|---|---|
| `data_freshness` | table | Last nightly/recompute run, latest FX month and its finality, catalog refresh dates, unpriced AI runs |
| `data_quality_checks` | table | `acquisition/data_quality_health_checks.md`, plus `contract_violations()` count |
| Alert rules and events | — | `admin_app` tables and the hourly evaluator (architecture §3.6) |
