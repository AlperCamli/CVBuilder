-- Phase 13: seed the medical_uk prompt profile (UK medical doctor / NHS CVs).
-- Rows live under profile 'medical_uk' and are resolved per request for CVs with
-- module_type = 'medical_uk'. Flows without a medical row fall back to the default
-- profile and then to the in-code flow registry, so this seed can never break a flow.

-- 1. cv_parse: parse raw medical CV text into the medical_uk section taxonomy.
insert into public.ai_prompt_configs (
  profile, flow_type, action_type, provider, model_name,
  prompt_key, prompt_version, system_prompt, user_prompt_template, is_active
)
select
  'medical_uk',
  'cv_parse',
  null,
  'any',
  null,
  'medical-cv-parse',
  'medical-v1',
  'Parse unstructured raw text of a UK medical doctor CV into the strictly structured JSON CV content format. '
  || 'Use this section taxonomy (section.type values): medical_registration (GMC number, licence status, registration date, NTN, visa status), '
  || 'medical_qualifications (one block per qualification with qualification, qualification_type one of primary/postgraduate/english_language/other, institution, year; MBBS/MBChB are primary; MRCP/MRCS/MRCGP/FRCA are postgraduate; PLAB/IELTS/OET are english_language), '
  || 'summary (personal summary and career goals), '
  || 'clinical_experience (one block per post with job_title, grade one of FY1/FY2/CT1-CT3/ST1-ST8/SpR/Specialty Doctor/SAS/Trust Grade/Locum/Consultant/Other, specialty, hospital, department, start_date, end_date, is_current, duties as bullet list, on_call_frequency, patient_demographics), '
  || 'career_gap (start_date, end_date, explanation), '
  || 'clinical_skills (one block per procedure with skill, competency_level one of independent/supervised/assisted/observed, frequency, context), '
  || 'audit_qi (one block per project with title, project_type audit or quality_improvement, role, setting, dates, standard_audited, outcomes as bullets, loop_closed boolean, presented_at), '
  || 'teaching (topic, setting, audience, audience_size, format one of one_to_one/small_group/lecture/simulation/e_learning, frequency, evaluation), '
  || 'publications (full citation with all authors, journal or conference, date), '
  || 'management_leadership (role, organization, dates, description as bullets), '
  || 'courses_training (name, provider, date, expiry_date, is_mandatory boolean; ALS/ATLS/APLS and similar are mandatory certifications), '
  || 'memberships (organization, membership_status, post_nominals, member_since), '
  || 'awards (title, issuer, date), interests (description), '
  || 'references (one block per referee with referee_name, position, hospital, relationship, years_known, contact). '
  || 'Detect GMC numbers (7 digits) and UK grade vocabulary. Keep section content reverse chronological. '
  || 'Long CVs are normal for medical applications: never discard or summarize content to shorten the document. '
  || 'Never invent facts, procedures, competency levels, outcomes, registration data, dates, or referees that are not present in the text. '
  || 'Use UK English spelling. Return strict JSON in the canonical cv_content format with free-form section and block type strings as listed above.',
  'Parse the raw medical CV text into canonical cv_content JSON using the medical_uk section taxonomy without inventing facts.',
  true
where not exists (
  select 1 from public.ai_prompt_configs
  where profile = 'medical_uk' and flow_type = 'cv_parse' and action_type is null and provider = 'any' and is_active = true
);

-- 2. import_improve: parent orchestration row (informational; not sent to the model).
insert into public.ai_prompt_configs (
  profile, flow_type, action_type, provider, model_name,
  prompt_key, prompt_version, system_prompt, user_prompt_template, is_active
)
select
  'medical_uk',
  'import_improve',
  null,
  'any',
  null,
  'medical-import-improve',
  'medical-v1',
  'Parent orchestration flow for imported UK medical CV improvement. The backend fans out block-level improvement and professional summary runs using the medical_uk profile, then returns one improved CV snapshot. This parent flow is not sent to the model.',
  'Orchestrate imported medical CV improvement using block-level AI runs.',
  true
where not exists (
  select 1 from public.ai_prompt_configs
  where profile = 'medical_uk' and flow_type = 'import_improve' and action_type is null and provider = 'any' and is_active = true
);

-- 3. professional_summary: two-paragraph clinical summary.
insert into public.ai_prompt_configs (
  profile, flow_type, action_type, provider, model_name,
  prompt_key, prompt_version, system_prompt, user_prompt_template, is_active
)
select
  'medical_uk',
  'professional_summary',
  null,
  'any',
  null,
  'medical-professional-summary',
  'medical-v1',
  'Write a personal summary for a UK medical doctor CV from the sanitized CV body. Use exactly two short paragraphs: '
  || 'the first states the current role, grade, specialty and clinical setting with years of experience; '
  || 'the second states career aspirations and motivation grounded only in signals present in the CV. '
  || 'Use a factual, conservative clinical register and UK English spelling. Do not use superlatives or marketing language. '
  || 'Never invent grades, specialties, achievements, or aspirations not supported by the CV content. '
  || 'Return strict JSON with one root key summary_text only.',
  'Write a two-paragraph personal summary (current role and grade, then career goals) from the sanitized medical CV body.',
  true
where not exists (
  select 1 from public.ai_prompt_configs
  where profile = 'medical_uk' and flow_type = 'professional_summary' and action_type is null and provider = 'any' and is_active = true
);

-- 4. block_suggest: default row plus per-action rows, all sharing medical guardrails.
insert into public.ai_prompt_configs (
  profile, flow_type, action_type, provider, model_name,
  prompt_key, prompt_version, system_prompt, user_prompt_template, is_active
)
select
  'medical_uk',
  'block_suggest',
  seed.action_type,
  'any',
  null,
  seed.prompt_key,
  'medical-v1',
  seed.system_prompt
  || ' MEDICAL GUARDRAILS: this block belongs to a UK medical doctor CV. Use a factual, conservative clinical register and UK English spelling. '
  || 'Never upgrade a competency level (for example supervised must never become independent), never change procedure frequencies, '
  || 'never invent audit outcomes or claim an audit loop was closed, never alter GMC or registration data, grades, dates, or qualifications. '
  || 'Keep UK grade nomenclature exact (FY1, FY2, CT1-CT3, ST1-ST8, SpR, Specialty Doctor, SAS, Consultant). '
  || 'Preserve truthful facts, IDs, type, order, visibility, and the original field shape. '
  || 'Return strict JSON with one root key suggested_block only.',
  seed.user_prompt_template,
  true
from (
  values
    (
      null::text,
      'medical-block-suggest',
      'Update one block of a UK medical doctor CV for the requested action.',
      'Return one updated suggested_block only.'
    ),
    (
      'improve',
      'medical-block-suggest-improve',
      'Improve one block of a UK medical doctor CV for clarity and clinical relevance. Strengthen action-outcome phrasing (especially for audit, quality improvement, and teaching content) without adding claims.',
      'Return one improved suggested_block only.'
    ),
    (
      'summarize',
      'medical-block-suggest-summarize',
      'Summarize one block of a UK medical doctor CV while retaining clinically significant detail (grades, specialties, competency levels, outcomes).',
      'Return one summarized suggested_block only.'
    ),
    (
      'expand',
      'medical-block-suggest-expand',
      'Expand one block of a UK medical doctor CV by elaborating only facts already stated (setting, responsibilities, structure of the work). Do not add procedures, outcomes, or experience that are not present.',
      'Return one expanded suggested_block only.'
    ),
    (
      'ats_optimize',
      'medical-block-suggest-person-spec',
      'Optimize one block of a UK medical doctor CV for NHS recruitment screening. Align wording with NHS person specification conventions (essential and desirable criteria) and Oriel/TRAC application phrasing using any available job context.',
      'Return one person-specification-optimized suggested_block only.'
    )
) as seed(action_type, prompt_key, system_prompt, user_prompt_template)
where not exists (
  select 1 from public.ai_prompt_configs existing
  where existing.profile = 'medical_uk'
    and existing.flow_type = 'block_suggest'
    and coalesce(existing.action_type, '') = coalesce(seed.action_type, '')
    and existing.provider = 'any'
    and existing.is_active = true
);
