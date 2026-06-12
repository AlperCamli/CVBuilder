import type { CvModuleDefinition } from "./cv-module.types";

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

// UK medical doctor (NHS) CV module. Section structure follows GMC/BMA/NHS Health
// Careers guidance; see backend/docs/medical-cv-gap-analysis.md for the sources and
// backend/docs/cv-modules-implementation-guide.md for the module contract.
export const medicalUkModule: CvModuleDefinition = {
  id: "medical_uk",
  label: "UK Medical CV",
  promptProfile: "medical_uk",
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
        { key: "gmc_number", label: "GMC Number", kind: "text", required: true },
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
      title: "Medical Qualifications",
      essential: true,
      description: "Primary and postgraduate medical qualifications, PLAB/IELTS/OET",
      defaultOrder: 2,
      blockType: "medical_qualification",
      fieldSchema: [
        { key: "qualification", label: "Qualification", kind: "text", required: true },
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
      defaultBlockFields: { qualification: "", qualification_type: "", institution: "", year: "" },
      aiSuggest: { editableFields: ["notes"] }
    },
    {
      type: "summary",
      title: "Personal Summary & Career Goals",
      essential: true,
      description: "Current role and grade, then your career aspirations",
      defaultOrder: 3,
      blockType: "summary",
      fieldSchema: [{ key: "text", label: "Summary", kind: "textarea" }],
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
      defaultBlockFields: {
        job_title: "",
        grade: "",
        specialty: "",
        hospital: "",
        duties: []
      },
      aiSuggest: { editableFields: ["duties"] }
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
      defaultBlockFields: { explanation: "" },
      aiSuggest: { editableFields: ["explanation"] }
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
      defaultBlockFields: { skill: "", competency_level: "", frequency: "" },
      aiSuggest: { editableFields: ["context"] }
    },
    {
      type: "additional_skills",
      title: "Additional Skills",
      essential: true,
      description: "Relevant non-clinical skills such as IT, communication and leadership",
      defaultOrder: 7,
      blockType: "additional_skill",
      fieldSchema: [
        { key: "skill", label: "Skill", kind: "text", required: true },
        { key: "context", label: "Context / Evidence", kind: "textarea" }
      ],
      defaultBlockFields: { skill: "", context: "" },
      aiSuggest: { editableFields: ["context"] }
    },
    {
      type: "audit_qi",
      title: "Clinical Audit & Quality Improvement",
      essential: true,
      description: "Audit and QI projects with your role and outcomes",
      defaultOrder: 8,
      blockType: "audit_qi_project",
      fieldSchema: [
        { key: "title", label: "Project Title", kind: "text", required: true },
        {
          key: "project_type",
          label: "Type",
          kind: "select",
          options: ["audit", "quality_improvement"]
        },
        { key: "role", label: "Your Role", kind: "text" },
        { key: "setting", label: "Setting", kind: "text" },
        { key: "dates", label: "Dates", kind: "text" },
        { key: "standard_audited", label: "Standard Audited", kind: "text" },
        { key: "outcomes", label: "Outcomes", kind: "bullets" },
        { key: "loop_closed", label: "Audit Loop Closed", kind: "boolean" },
        { key: "presented_at", label: "Presented At", kind: "text" }
      ],
      defaultBlockFields: { title: "", project_type: "", role: "", outcomes: [] },
      aiSuggest: { editableFields: ["outcomes"] }
    },
    {
      type: "teaching",
      title: "Teaching Experience",
      essential: true,
      description: "Teaching with setting, audience and evaluation",
      defaultOrder: 9,
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
      defaultBlockFields: { topic: "", setting: "", audience: "" },
      aiSuggest: { editableFields: ["evaluation"] }
    },
    {
      type: "publications",
      title: "Research & Publications",
      essential: false,
      description: "Full citations with all authors; posters and presentations",
      defaultOrder: 10,
      blockType: "publications",
      fieldSchema: [
        { key: "title", label: "Citation / Title", kind: "textarea" },
        { key: "publisher", label: "Journal / Conference", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "management_leadership",
      title: "Management & Leadership",
      essential: false,
      description: "Committees, rota coordination and leadership roles",
      defaultOrder: 11,
      blockType: "management_role",
      fieldSchema: [
        { key: "role", label: "Role", kind: "text", required: true },
        { key: "organization", label: "Organisation / Department", kind: "text" },
        { key: "dates", label: "Dates", kind: "text" },
        { key: "description", label: "Description", kind: "bullets" }
      ],
      defaultBlockFields: { role: "", organization: "", description: [] },
      aiSuggest: { editableFields: ["description"] }
    },
    {
      type: "courses_training",
      title: "Courses & Mandatory Training",
      essential: true,
      description: "Courses, conferences and mandatory certifications (ALS, ATLS...)",
      defaultOrder: 12,
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
      defaultOrder: 13,
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
      defaultOrder: 14,
      blockType: "awards",
      fieldSchema: [
        { key: "title", label: "Award", kind: "text" },
        { key: "issuer", label: "Awarding Body", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "interests",
      title: "Interests",
      essential: false,
      description: "Non-clinical interests",
      defaultOrder: 15,
      blockType: "interests",
      fieldSchema: [{ key: "description", label: "Interests", kind: "textarea" }],
      defaultBlockFields: { description: "" }
    },
    {
      type: "volunteer",
      title: "Extracurricular Activities",
      essential: false,
      description: "Relevant extracurricular roles, societies and community activities",
      defaultOrder: 16,
      blockType: "volunteer_item",
      fieldSchema: [
        { key: "organization", label: "Organisation", kind: "text" },
        { key: "role", label: "Role", kind: "text" },
        { key: "start_date", label: "Start Date", kind: "date" },
        { key: "end_date", label: "End Date", kind: "date" },
        { key: "description", label: "Description", kind: "textarea" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "references",
      title: "References",
      essential: false,
      description: "Three senior clinicians covering the last three years",
      defaultOrder: 17,
      blockType: "references",
      fieldSchema: [
        { key: "referee_name", label: "Name", kind: "text", required: true },
        { key: "position", label: "Position / Grade", kind: "text" },
        { key: "hospital", label: "Hospital / Trust", kind: "text" },
        { key: "relationship", label: "Relationship", kind: "text" },
        { key: "years_known", label: "Years Known", kind: "text" },
        { key: "contact", label: "Contact Details", kind: "text" }
      ],
      defaultBlockFields: { referee_name: "", position: "", hospital: "" }
    }
  ],
  parserSectionHints: [
    {
      type: "medical_registration",
      title: "Professional Registration",
      aliases: [
        "gmc registration",
        "professional registration",
        "registration details",
        "registration",
        "gmc"
      ],
      keywords: ["gmc", "licence to practise", "national training number", "ntn"]
    },
    {
      type: "medical_qualifications",
      title: "Medical Qualifications",
      aliases: [
        "professional qualifications",
        "postgraduate qualifications",
        "medical qualifications",
        "qualifications"
      ],
      keywords: ["mbbs", "mbchb", "mrcp", "mrcs", "mrcgp", "frca", "plab", "ielts", "oet"]
    },
    {
      type: "summary",
      title: "Personal Summary & Career Goals",
      aliases: ["career goals", "career aim", "personal statement", "personal summary"],
      keywords: ["career", "aspiration"]
    },
    {
      type: "clinical_experience",
      title: "Clinical Experience",
      aliases: [
        "clinical experience",
        "current post",
        "current appointment",
        "current employment",
        "previous posts",
        "previous appointments",
        "employment history",
        "clinical posts",
        "clinical appointments"
      ],
      keywords: ["registrar", "foundation", "consultant", "rotation", "on-call", "nhs trust", "ward"]
    },
    {
      type: "clinical_skills",
      title: "Clinical Skills & Procedures",
      aliases: [
        "clinical skills",
        "procedural skills",
        "procedures",
        "practical procedures",
        "competencies",
        "clinical competencies"
      ],
      keywords: ["procedure", "supervised", "independent", "competency"]
    },
    {
      type: "additional_skills",
      title: "Additional Skills",
      aliases: ["additional skills", "other skills", "transferable skills", "non-clinical skills"],
      keywords: ["it skills", "communication", "leadership", "teamwork"]
    },
    {
      type: "audit_qi",
      title: "Clinical Audit & Quality Improvement",
      aliases: [
        "clinical audit",
        "audit",
        "audits",
        "quality improvement",
        "qip",
        "service improvement",
        "audit and quality improvement"
      ],
      keywords: ["audit", "quality improvement", "qip", "loop closed", "re-audit"]
    },
    {
      type: "teaching",
      title: "Teaching Experience",
      aliases: ["teaching", "teaching experience", "medical education", "teaching and training"],
      keywords: ["teaching", "taught", "medical students", "tutor", "lecture"]
    },
    {
      type: "management_leadership",
      title: "Management & Leadership",
      aliases: ["management", "leadership", "management and leadership", "management experience"],
      keywords: ["rota", "committee", "leadership"]
    },
    {
      type: "courses_training",
      title: "Courses & Mandatory Training",
      aliases: [
        "courses attended",
        "conferences",
        "mandatory training",
        "study days",
        "courses and conferences"
      ],
      keywords: ["als", "atls", "apls", "study day", "conference"]
    },
    {
      type: "memberships",
      title: "Professional Memberships",
      aliases: ["professional memberships", "memberships", "professional bodies"],
      keywords: ["bma", "royal college", "member", "fellowship"]
    },
    {
      type: "awards",
      title: "Awards & Prizes",
      aliases: ["prizes", "awards and prizes", "honours and prizes"],
      keywords: ["prize", "award", "distinction"]
    },
    {
      type: "career_gap",
      title: "Career Gaps",
      aliases: ["career gaps", "career break", "employment gaps"],
      keywords: ["career break", "gap"]
    },
    {
      type: "interests",
      title: "Interests",
      aliases: ["interests", "hobbies and interests", "personal interests"],
      keywords: ["interest", "hobby"]
    },
    {
      type: "volunteer",
      title: "Extracurricular Activities",
      aliases: ["extracurricular activities", "volunteer work", "volunteering", "societies"],
      keywords: ["volunteer", "society", "committee", "extracurricular"]
    }
  ]
};
