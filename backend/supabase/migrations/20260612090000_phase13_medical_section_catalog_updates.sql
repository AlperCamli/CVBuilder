-- Phase 13 follow-up: align the medical_uk prompt taxonomy with the editor catalog.
-- The original seed migration has already been pushed, so keep that file immutable
-- and update the active prompt row here.

update public.ai_prompt_configs
set
  prompt_version = 'medical-v2',
  system_prompt = 'Parse unstructured raw text of a UK medical doctor CV into the strictly structured JSON CV content format. '
  || 'Use this section taxonomy (section.type values): medical_registration (GMC number, licence status, registration date, NTN, visa status), '
  || 'medical_qualifications (one block per qualification with qualification, qualification_type one of primary/postgraduate/english_language/other, institution, year; MBBS/MBChB are primary; MRCP/MRCS/MRCGP/FRCA are postgraduate; PLAB/IELTS/OET are english_language), '
  || 'summary (personal summary and career goals), '
  || 'clinical_experience (one block per post with job_title, grade one of FY1/FY2/CT1-CT3/ST1-ST8/SpR/Specialty Doctor/SAS/Trust Grade/Locum/Consultant/Other, specialty, hospital, department, start_date, end_date, is_current, duties as bullet list, on_call_frequency, patient_demographics), '
  || 'career_gap (start_date, end_date, explanation), '
  || 'clinical_skills (one block per procedure with skill, competency_level one of independent/supervised/assisted/observed, frequency, context), '
  || 'additional_skills (one block per relevant non-clinical skill with skill and context), '
  || 'audit_qi (one block per project with title, project_type audit or quality_improvement, role, setting, dates, standard_audited, outcomes as bullets, loop_closed boolean, presented_at), '
  || 'teaching (topic, setting, audience, audience_size, format one of one_to_one/small_group/lecture/simulation/e_learning, frequency, evaluation), '
  || 'publications (full citation with all authors, journal or conference, date), '
  || 'management_leadership (role, organization, dates, description as bullets), '
  || 'courses_training (name, provider, date, expiry_date, is_mandatory boolean; ALS/ATLS/APLS and similar are mandatory certifications), '
  || 'memberships (organization, membership_status, post_nominals, member_since), '
  || 'awards (title, issuer, date), interests (description), volunteer (extracurricular activities, societies, community roles or volunteering), '
  || 'references (one block per referee with referee_name, position, hospital, relationship, years_known, contact). '
  || 'Detect GMC numbers (7 digits) and UK grade vocabulary. Keep section content reverse chronological. '
  || 'Long CVs are normal for medical applications: never discard or summarize content to shorten the document. '
  || 'Never invent facts, procedures, competency levels, outcomes, registration data, dates, or referees that are not present in the text. '
  || 'Use UK English spelling. Return strict JSON in the canonical cv_content format with free-form section and block type strings as listed above.'
where profile = 'medical_uk'
  and flow_type = 'cv_parse'
  and action_type is null
  and provider = 'any'
  and is_active = true;
