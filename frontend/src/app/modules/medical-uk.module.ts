import type { CvModuleDefinition } from "./cv-module.types";

// Frontend mirror of backend/src/shared/cv-modules/medical-uk.module.ts.
// Section types whose ids match standard types (summary, publications, awards,
// references) render through the existing standard components; the rest render
// through the descriptor-driven ModuleSection using these field schemas.

export const MEDICAL_UK_GRADES = [
  "FY1",
  "FY2",
  "CT1",
  "CT2",
  "CT3",
  "ST1",
  "ST2",
  "ST3",
  "ST4",
  "ST5",
  "ST6",
  "ST7",
  "ST8",
  "SpR",
  "Specialty Doctor",
  "SAS",
  "Trust Grade",
  "Locum",
  "Consultant",
  "Other"
];

export const MEDICAL_UK_COMPETENCY_LEVELS = ["independent", "supervised", "assisted", "observed"];

export const medicalUkModule: CvModuleDefinition = {
  id: "medical_uk",
  label: "UK Medical CV",
  templateSlugs: ["medical-classic", "medical-professional"],
  defaultTemplateSlug: "medical-classic",
  validation: {
    discouragePhoto: true,
    discouragedMetadataFields: ["date_of_birth", "marital_status"]
  },
  sectionCatalog: [
    {
      type: "medical_registration",
      title: "Professional Registration",
      essential: true,
      description: "GMC registration, licence status and training number",
      defaultOrder: 1,
      blockType: "medical_registration",
      fieldSchema: [
        { key: "gmc_number", label: "GMC Number", kind: "text", required: true, placeholder: "e.g. 1234567" },
        {
          key: "licence_status",
          label: "Licence Status",
          kind: "select",
          options: ["Full licence to practise", "Provisional registration", "No licence"]
        },
        { key: "registration_date", label: "Registration Date", kind: "date" },
        { key: "ntn", label: "National Training Number (NTN)", kind: "text" },
        { key: "visa_status", label: "Visa / Right to Work", kind: "text" },
        { key: "additional_registrations", label: "Other Registrations", kind: "textarea" }
      ],
      defaultBlockFields: { gmc_number: "", licence_status: "", ntn: "" }
    },
    {
      type: "medical_qualifications",
      title: "Professional Qualifications",
      essential: true,
      description: "Primary and postgraduate qualifications, PLAB/IELTS/OET",
      defaultOrder: 2,
      blockType: "medical_qualification",
      fieldSchema: [
        { key: "qualification", label: "Qualification", kind: "text", required: true, placeholder: "e.g. MBBS, MRCP" },
        {
          key: "qualification_type",
          label: "Type",
          kind: "select",
          options: ["primary", "postgraduate", "english_language", "other"]
        },
        { key: "institution", label: "Institution / Awarding Body", kind: "text" },
        { key: "year", label: "Year", kind: "text" },
        { key: "notes", label: "Notes", kind: "textarea" }
      ],
      defaultBlockFields: { qualification: "", qualification_type: "", institution: "", year: "" }
    },
    {
      type: "summary",
      title: "Personal Summary & Career Goals",
      essential: true,
      description: "Current role and grade, then your career aspirations",
      defaultOrder: 3,
      blockType: "summary",
      fieldSchema: [],
      defaultBlockFields: { text: "" }
    },
    {
      type: "clinical_experience",
      title: "Clinical Experience",
      essential: true,
      description: "Posts with grade, specialty, hospital and duties",
      defaultOrder: 4,
      blockType: "clinical_post",
      fieldSchema: [
        { key: "job_title", label: "Job Title", kind: "text", required: true },
        { key: "grade", label: "Grade", kind: "select", options: MEDICAL_UK_GRADES },
        { key: "specialty", label: "Specialty", kind: "text" },
        { key: "hospital", label: "Hospital / Trust", kind: "text" },
        { key: "department", label: "Department", kind: "text" },
        { key: "start_date", label: "Start Date", kind: "date" },
        { key: "end_date", label: "End Date", kind: "date" },
        { key: "is_current", label: "Current Post", kind: "boolean" },
        { key: "duties", label: "Duties & Responsibilities", kind: "bullets" },
        { key: "on_call_frequency", label: "On-call Frequency / Rota", kind: "text" },
        { key: "patient_demographics", label: "Patient Demographics / Setting", kind: "text" }
      ],
      defaultBlockFields: { job_title: "", grade: "", specialty: "", hospital: "", duties: [] }
    },
    {
      type: "career_gap",
      title: "Career Gaps",
      essential: false,
      description: "Explain any gaps in your clinical career",
      defaultOrder: 5,
      blockType: "career_gap",
      fieldSchema: [
        { key: "start_date", label: "From", kind: "date" },
        { key: "end_date", label: "To", kind: "date" },
        { key: "explanation", label: "Explanation", kind: "textarea", required: true }
      ],
      defaultBlockFields: { explanation: "" }
    },
    {
      type: "clinical_skills",
      title: "Clinical Skills & Procedures",
      essential: true,
      description: "Procedures with competency level and frequency",
      defaultOrder: 6,
      blockType: "clinical_skill",
      fieldSchema: [
        { key: "skill", label: "Skill / Procedure", kind: "text", required: true },
        {
          key: "competency_level",
          label: "Competency Level",
          kind: "select",
          options: MEDICAL_UK_COMPETENCY_LEVELS
        },
        { key: "frequency", label: "Frequency Performed", kind: "text" },
        { key: "context", label: "Context / Setting", kind: "text" }
      ],
      defaultBlockFields: { skill: "", competency_level: "", frequency: "" }
    },
    {
      type: "audit_qi",
      title: "Clinical Audit & Quality Improvement",
      essential: true,
      description: "Audit and QI projects with your role and outcomes",
      defaultOrder: 7,
      blockType: "audit_qi_project",
      fieldSchema: [
        { key: "title", label: "Project Title", kind: "text", required: true },
        { key: "project_type", label: "Type", kind: "select", options: ["audit", "quality_improvement"] },
        { key: "role", label: "Your Role", kind: "text" },
        { key: "setting", label: "Setting", kind: "text" },
        { key: "dates", label: "Dates", kind: "text" },
        { key: "standard_audited", label: "Standard Audited", kind: "text" },
        { key: "outcomes", label: "Outcomes", kind: "bullets" },
        { key: "loop_closed", label: "Audit Loop Closed", kind: "boolean" },
        { key: "presented_at", label: "Presented At", kind: "text" }
      ],
      defaultBlockFields: { title: "", project_type: "", role: "", outcomes: [] }
    },
    {
      type: "teaching",
      title: "Teaching Experience",
      essential: true,
      description: "Teaching with setting, audience and evaluation",
      defaultOrder: 8,
      blockType: "teaching_activity",
      fieldSchema: [
        { key: "topic", label: "Topic / Programme", kind: "text", required: true },
        { key: "setting", label: "Setting", kind: "text" },
        { key: "audience", label: "Audience", kind: "text" },
        { key: "audience_size", label: "Audience Size", kind: "text" },
        {
          key: "format",
          label: "Format",
          kind: "select",
          options: ["one_to_one", "small_group", "lecture", "simulation", "e_learning"]
        },
        { key: "frequency", label: "Frequency", kind: "text" },
        { key: "evaluation", label: "Evaluation / Feedback", kind: "textarea" }
      ],
      defaultBlockFields: { topic: "", setting: "", audience: "" }
    },
    {
      type: "publications",
      title: "Research & Publications",
      essential: false,
      description: "Full citations with all authors; posters and presentations",
      defaultOrder: 9,
      blockType: "publications",
      fieldSchema: [],
      defaultBlockFields: {}
    },
    {
      type: "management_leadership",
      title: "Management & Leadership",
      essential: false,
      description: "Committees, rota coordination and leadership roles",
      defaultOrder: 10,
      blockType: "management_role",
      fieldSchema: [
        { key: "role", label: "Role", kind: "text", required: true },
        { key: "organization", label: "Organisation / Department", kind: "text" },
        { key: "dates", label: "Dates", kind: "text" },
        { key: "description", label: "Description", kind: "bullets" }
      ],
      defaultBlockFields: { role: "", organization: "", description: [] }
    },
    {
      type: "courses_training",
      title: "Courses & Mandatory Training",
      essential: true,
      description: "Courses, conferences and mandatory certifications (ALS, ATLS...)",
      defaultOrder: 11,
      blockType: "course_entry",
      fieldSchema: [
        { key: "name", label: "Course / Conference", kind: "text", required: true },
        { key: "provider", label: "Provider", kind: "text" },
        { key: "date", label: "Date", kind: "date" },
        { key: "expiry_date", label: "Valid Until", kind: "date" },
        { key: "is_mandatory", label: "Mandatory Certification", kind: "boolean" }
      ],
      defaultBlockFields: { name: "", provider: "" }
    },
    {
      type: "memberships",
      title: "Professional Memberships",
      essential: false,
      description: "BMA, royal colleges and specialty societies",
      defaultOrder: 12,
      blockType: "membership",
      fieldSchema: [
        { key: "organization", label: "Organisation", kind: "text", required: true },
        { key: "membership_status", label: "Status", kind: "text" },
        { key: "post_nominals", label: "Post-nominals", kind: "text" },
        { key: "member_since", label: "Member Since", kind: "date" }
      ],
      defaultBlockFields: { organization: "" }
    },
    {
      type: "awards",
      title: "Awards & Prizes",
      essential: false,
      description: "Awarding body, reason and date",
      defaultOrder: 13,
      blockType: "awards",
      fieldSchema: [],
      defaultBlockFields: {}
    },
    {
      type: "interests",
      title: "Interests",
      essential: false,
      description: "Non-clinical interests",
      defaultOrder: 14,
      blockType: "interests",
      fieldSchema: [{ key: "description", label: "Interests", kind: "textarea" }],
      defaultBlockFields: { description: "" }
    },
    {
      type: "references",
      title: "References",
      essential: false,
      description: "Three senior clinicians covering the last three years",
      defaultOrder: 15,
      blockType: "references",
      fieldSchema: [],
      defaultBlockFields: {}
    }
  ]
};
