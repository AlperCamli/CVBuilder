import type {
  PresentationTheme,
  RenderingPresentation,
} from "../../integration/api-types";

// The production renderer's public presentation shape and real template tokens.
// Content is fictional; these examples never call authenticated APIs.
export const DEMO_TEMPLATES: PresentationTheme[] = [
  {
    layout: "modern-clean",
    mode: "classic-single-column",
    template_slug: "modern-clean",
    template_name: "Modern Clean",
    tokens: {
      font_family: '"Source Serif 4", serif',
      font_asset_key: "source-serif-4",
      heading_color_hex: "#111827",
      accent_color_hex: "#0f5ea6",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 16,
      block_spacing: 12,
      body_text_size: 12,
      compact_density: true,
    },
  },
  {
    layout: "minimal-professional",
    mode: "compact-single-column",
    template_slug: "minimal-professional",
    template_name: "Minimal Professional",
    tokens: {
      font_family: '"Noto Sans", sans-serif',
      font_asset_key: "noto-sans",
      heading_color_hex: "#121212",
      accent_color_hex: "#4b5563",
      body_color_hex: "#1f1f1f",
      muted_color_hex: "#606060",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 11,
      compact_density: true,
    },
  },
  {
    layout: "two-column-modern",
    mode: "portfolio-two-column",
    template_slug: "latex-two-column",
    template_name: "LaTeX Two Column",
    tokens: {
      font_family: '"Libertinus Serif", serif',
      font_asset_key: "libertinus-serif",
      section_heading_style: "ruled",
      heading_color_hex: "#111111",
      accent_color_hex: "#111111",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 12,
      block_spacing: 8,
      body_text_size: 10.8,
      compact_density: true,
    },
  },
];

export const DEMO_SUMMARY =
  "Data analyst with experience in Excel reporting, sales analysis, and communicating insights. Turns everyday sales data into clear reports that help teams make informed decisions.";
export const DEMO_BULLET =
  "Prepared weekly Excel reports to track sales performance and highlight trends.";

export function makeDemoPresentation({
  template,
  summary,
  bullet,
  skills,
  showSummary = true,
}: {
  template: number;
  summary: string;
  bullet: string;
  skills: string[];
  showSummary?: boolean;
}): RenderingPresentation {
  return {
    version: "v1",
    document_title: "Alex Morgan — Data Analyst",
    theme: DEMO_TEMPLATES[template],
    header: {
      name: "Alex Morgan",
      title: "Data Analyst",
      email: "alex@example.com",
      phone: null,
      location: "London, UK",
      photo: null,
      photo_shape: "circle",
      photo_position: "left",
      contact_items: ["alex@example.com", "London, UK"],
      social_links: [],
    },
    sections: [
      ...(showSummary
        ? [
            {
              id: "summary",
              type: "summary",
              title: "Professional Summary",
              inline_text: summary,
              items: [],
            },
          ]
        : []),
      {
        id: "experience",
        type: "experience",
        title: "Work Experience",
        inline_text: null,
        items: [
          {
            id: "exp-1",
            title: "Reporting Assistant",
            subtitle: "Example Company",
            date_range: "2023 – Present",
            location: "London, UK",
            metadata_line: "2023 – Present",
            body: null,
            bullets: [
              bullet,
              "Organized sales records and checked source data for consistency.",
              "Shared reporting updates with the sales team.",
            ],
          },
          {
            id: "exp-2",
            title: "Operations Intern",
            subtitle: "Sample Studio",
            date_range: "2022 – 2023",
            location: "London, UK",
            metadata_line: "2022 – 2023",
            body: null,
            bullets: [
              "Maintained team spreadsheets and prepared weekly activity summaries.",
              "Worked with colleagues to keep project records up to date.",
            ],
          },
        ],
      },
      {
        id: "education",
        type: "education",
        title: "Education",
        inline_text: null,
        items: [
          {
            id: "ed-1",
            title: "BSc Business Management",
            subtitle: "Example University",
            date_range: "2019 – 2022",
            location: null,
            metadata_line: "2019 – 2022",
            body: null,
            bullets: [],
          },
        ],
      },
      {
        id: "skills",
        type: "skills",
        title: "Skills",
        inline_text: skills.join(" · "),
        items: [],
      },
      {
        id: "languages",
        type: "languages",
        title: "Languages",
        inline_text: "English — fluent",
        items: [],
      },
    ],
  };
}
