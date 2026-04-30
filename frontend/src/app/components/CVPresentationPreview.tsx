import { Globe, Github, Linkedin } from "lucide-react";
import type {
  PresentationItem,
  PresentationSection,
  RenderingPresentation
} from "../integration/api-types";

interface CVPresentationPreviewProps {
  presentation: RenderingPresentation | null;
}

const getSocialIcon = (type: string) => {
  switch (type.trim().toLowerCase()) {
    case "github":
      return Github;
    case "linkedin":
      return Linkedin;
    default:
      return Globe;
  }
};

const renderItemBody = (item: PresentationItem, bodyColor: string) => {
  if (item.bullets.length > 0) {
    return (
      <ul className="mt-1" style={{ paddingLeft: "16px", color: bodyColor, listStyle: "disc" }}>
        {item.bullets.map((bullet, index) => (
          <li key={`${item.id}-bullet-${index}`} style={{ fontSize: "12px", lineHeight: "1.5" }}>
            {bullet}
          </li>
        ))}
      </ul>
    );
  }

  if (item.body) {
    return (
      <p style={{ fontSize: "12px", lineHeight: "1.6", color: bodyColor, whiteSpace: "pre-line", marginTop: "4px" }}>
        {item.body}
      </p>
    );
  }

  return null;
};

const renderDefaultSection = (
  section: PresentationSection,
  colors: { heading: string; body: string; muted: string },
  sectionSpacing: number,
  blockSpacing: number
) => {
  return (
    <div key={section.id} style={{ marginBottom: `${sectionSpacing}px` }}>
      <h2 style={{ fontSize: "14px", fontWeight: 600, color: colors.heading, marginBottom: "8px" }}>{section.title}</h2>

      {section.inline_text ? (
        <p style={{ fontSize: "12px", lineHeight: "1.6", color: colors.body }}>{section.inline_text}</p>
      ) : (
        section.items.map((item) => (
          <div key={item.id} style={{ marginBottom: `${blockSpacing}px` }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                {item.title ? <h3 style={{ fontSize: "13px", fontWeight: 600, color: colors.heading }}>{item.title}</h3> : null}
                {item.subtitle ? <p style={{ fontSize: "12px", color: colors.body }}>{item.subtitle}</p> : null}
              </div>
              {(item.metadata_line || item.date_range) ? (
                <span style={{ fontSize: "11px", color: colors.muted, textAlign: "right" }}>
                  {item.metadata_line || item.date_range}
                </span>
              ) : null}
            </div>
            {renderItemBody(item, colors.body)}
          </div>
        ))
      )}
    </div>
  );
};

const renderTimelineSection = (
  section: PresentationSection,
  colors: { heading: string; body: string; muted: string; accent: string },
  sectionSpacing: number,
  blockSpacing: number
) => {
  return (
    <div key={section.id} style={{ marginBottom: `${sectionSpacing}px` }}>
      <h2 style={{ fontSize: "14px", fontWeight: 600, color: colors.heading, marginBottom: "8px" }}>{section.title}</h2>

      {section.inline_text ? (
        <p style={{ fontSize: "12px", lineHeight: "1.6", color: colors.body }}>{section.inline_text}</p>
      ) : (
        <div className="space-y-2">
          {section.items.map((item) => (
            <div key={item.id} style={{ marginBottom: `${blockSpacing}px` }} className="grid grid-cols-[110px_1fr] gap-3">
              <div style={{ fontSize: "11px", color: colors.muted, paddingTop: "2px" }}>{item.metadata_line || item.date_range || ""}</div>
              <div className="relative pl-4">
                <span
                  style={{
                    position: "absolute",
                    left: "0px",
                    top: "4px",
                    width: "7px",
                    height: "7px",
                    borderRadius: "999px",
                    background: colors.accent
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: "3px",
                    top: "11px",
                    bottom: "0px",
                    width: "1px",
                    background: `${colors.accent}55`
                  }}
                />
                {item.title ? <h3 style={{ fontSize: "13px", fontWeight: 600, color: colors.heading }}>{item.title}</h3> : null}
                {item.subtitle ? <p style={{ fontSize: "12px", color: colors.body }}>{item.subtitle}</p> : null}
                {renderItemBody(item, colors.body)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function CVPresentationPreview({ presentation }: CVPresentationPreviewProps) {
  if (!presentation) {
    return (
      <div className="bg-white shadow-lg" style={{ width: "595px", minHeight: "842px", padding: "48px 40px" }}>
        <p style={{ fontSize: "13px", color: "#6B7280" }}>Preview will appear after content is loaded.</p>
      </div>
    );
  }

  const theme = presentation.theme;
  const tokens = theme.tokens;
  const colors = {
    heading: tokens.heading_color_hex,
    accent: tokens.accent_color_hex,
    body: tokens.body_color_hex,
    muted: tokens.muted_color_hex
  };

  const header = presentation.header;
  const sideSectionTypes = new Set(["skills", "languages", "references", "certifications", "courses"]);
  const sidebarSections = presentation.sections.filter((section) => sideSectionTypes.has(section.type));
  const mainSections = presentation.sections.filter((section) => !sideSectionTypes.has(section.type));

  return (
    <div
      className="shadow-lg"
      style={{
        width: "595px",
        minHeight: "842px",
        padding: theme.mode === "compact-single-column" ? "38px 34px" : "46px 38px",
        fontFamily: tokens.font_family,
        background: tokens.page_background_hex,
        color: colors.body
      }}
    >
      <div className="flex items-start gap-4">
        {header.photo ? (
          <img
            src={header.photo}
            alt="Profile"
            style={{ width: "58px", height: "58px", borderRadius: "999px", objectFit: "cover", flexShrink: 0 }}
          />
        ) : null}

        <div className="flex-1 min-w-0">
          <h1 style={{ fontSize: theme.mode === "compact-single-column" ? "21px" : "23px", color: colors.heading, fontWeight: 600 }}>
            {header.name || "Your Name"}
          </h1>
          {header.title ? (
            <p style={{ fontSize: "14px", color: colors.accent, marginTop: "2px" }}>{header.title}</p>
          ) : null}
          {header.contact_items.length > 0 ? (
            <p style={{ fontSize: "11px", color: colors.muted, marginTop: "6px" }}>{header.contact_items.join(" • ")}</p>
          ) : null}
          {header.social_links.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {header.social_links.map((link) => {
                const Icon = getSocialIcon(link.type);
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: "11px", color: colors.muted, textDecoration: "underline" }}
                  >
                    <Icon size={11} />
                    <span>{link.label}</span>
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: "1px", background: `${colors.muted}33`, marginTop: "12px", marginBottom: "14px" }} />

      {theme.mode === "portfolio-two-column" ? (
        <div className="grid grid-cols-[170px_1fr] gap-5">
          <aside
            style={{
              background: `${colors.accent}0d`,
              border: `1px solid ${colors.accent}2c`,
              borderRadius: "10px",
              padding: "12px"
            }}
          >
            {sidebarSections.map((section) =>
              renderDefaultSection(section, colors, Math.max(10, tokens.section_spacing - 3), Math.max(6, tokens.block_spacing - 3))
            )}
          </aside>

          <main>
            {mainSections.map((section) =>
              renderDefaultSection(section, colors, tokens.section_spacing, tokens.block_spacing)
            )}
          </main>
        </div>
      ) : theme.mode === "timeline-split" ? (
        <div>
          {presentation.sections.map((section) => renderTimelineSection(section, colors, tokens.section_spacing, tokens.block_spacing))}
        </div>
      ) : (
        <div>
          {presentation.sections.map((section) => renderDefaultSection(section, colors, tokens.section_spacing, tokens.block_spacing))}
        </div>
      )}
    </div>
  );
}
