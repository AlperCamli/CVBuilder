import { Globe, Github, Linkedin } from "lucide-react";
import type {
  PresentationItem,
  PresentationSection,
  RenderingPresentation
} from "../integration/api-types";

type PreviewMode = "full" | "thumbnail";

interface CVPresentationPreviewProps {
  presentation: RenderingPresentation | null;
  fontScale?: number;
  mode?: PreviewMode;
}

const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.15;

const clampFontScale = (value: number): number => {
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
};

const scaledPx = (px: number): string => `calc(${px}px * var(--cv-font-scale))`;

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

const renderItemBody = (
  item: PresentationItem,
  bodyColor: string
) => {
  if (item.bullets.length > 0) {
    return (
      <ul className="mt-1" style={{ paddingLeft: scaledPx(16), color: bodyColor, listStyle: "disc" }}>
        {item.bullets.map((bullet, index) => (
          <li key={`${item.id}-bullet-${index}`} style={{ fontSize: scaledPx(12), lineHeight: 1.5 }}>
            {bullet}
          </li>
        ))}
      </ul>
    );
  }

  if (item.body) {
    return (
      <p
        style={{
          fontSize: scaledPx(12),
          lineHeight: 1.6,
          color: bodyColor,
          whiteSpace: "pre-line",
          marginTop: scaledPx(4)
        }}
      >
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
    <div key={section.id} style={{ marginBottom: scaledPx(sectionSpacing) }}>
      <h2 style={{ fontSize: scaledPx(14), fontWeight: 600, color: colors.heading, marginBottom: scaledPx(8) }}>{section.title}</h2>

      {section.inline_text ? (
        <p style={{ fontSize: scaledPx(12), lineHeight: 1.6, color: colors.body }}>{section.inline_text}</p>
      ) : (
        section.items.map((item) => (
          <div key={item.id} style={{ marginBottom: scaledPx(blockSpacing) }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                {item.title ? <h3 style={{ fontSize: scaledPx(13), fontWeight: 600, color: colors.heading }}>{item.title}</h3> : null}
                {item.subtitle ? <p style={{ fontSize: scaledPx(12), color: colors.body }}>{item.subtitle}</p> : null}
              </div>
              {(item.metadata_line || item.date_range) ? (
                <span style={{ fontSize: scaledPx(11), color: colors.muted, textAlign: "right" }}>
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
    <div key={section.id} style={{ marginBottom: scaledPx(sectionSpacing) }}>
      <h2 style={{ fontSize: scaledPx(14), fontWeight: 600, color: colors.heading, marginBottom: scaledPx(8) }}>{section.title}</h2>

      {section.inline_text ? (
        <p style={{ fontSize: scaledPx(12), lineHeight: 1.6, color: colors.body }}>{section.inline_text}</p>
      ) : (
        <div className="space-y-2">
          {section.items.map((item) => (
            <div key={item.id} style={{ marginBottom: scaledPx(blockSpacing), gridTemplateColumns: `${scaledPx(110)} 1fr` }} className="grid gap-3">
              <div style={{ fontSize: scaledPx(11), color: colors.muted, paddingTop: scaledPx(2) }}>{item.metadata_line || item.date_range || ""}</div>
              <div className="relative" style={{ paddingLeft: scaledPx(16) }}>
                <span
                  style={{
                    position: "absolute",
                    left: "0px",
                    top: scaledPx(4),
                    width: scaledPx(7),
                    height: scaledPx(7),
                    borderRadius: "999px",
                    background: colors.accent
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: scaledPx(3),
                    top: scaledPx(11),
                    bottom: "0px",
                    width: "1px",
                    background: `${colors.accent}55`
                  }}
                />
                {item.title ? <h3 style={{ fontSize: scaledPx(13), fontWeight: 600, color: colors.heading }}>{item.title}</h3> : null}
                {item.subtitle ? <p style={{ fontSize: scaledPx(12), color: colors.body }}>{item.subtitle}</p> : null}
                {renderItemBody(item, colors.body)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function CVPresentationPreview({
  presentation,
  fontScale = 1,
  mode = "full"
}: CVPresentationPreviewProps) {
  const resolvedScale = clampFontScale(fontScale);
  const rootScaleStyle = {
    "--cv-font-scale": String(resolvedScale)
  } as React.CSSProperties;

  if (!presentation) {
    return (
      <div
        className={mode === "thumbnail" ? "bg-white shadow-sm" : "bg-white shadow-lg"}
        style={{
          ...rootScaleStyle,
          width: "595px",
          minHeight: "842px",
          padding: scaledPx(40)
        }}
      >
        <p style={{ fontSize: scaledPx(13), color: "#6B7280" }}>Preview will appear after content is loaded.</p>
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
      className={mode === "thumbnail" ? "shadow-sm" : "shadow-lg"}
      style={{
        ...rootScaleStyle,
        width: "595px",
        minHeight: "842px",
        padding: theme.mode === "compact-single-column" ? `${scaledPx(38)} ${scaledPx(34)}` : `${scaledPx(46)} ${scaledPx(38)}`,
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
            style={{ width: scaledPx(58), height: scaledPx(58), borderRadius: "999px", objectFit: "cover", flexShrink: 0 }}
          />
        ) : null}

        <div className="flex-1 min-w-0">
          <h1 style={{ fontSize: theme.mode === "compact-single-column" ? scaledPx(21) : scaledPx(23), color: colors.heading, fontWeight: 600 }}>
            {header.name || "Your Name"}
          </h1>
          {header.title ? (
            <p style={{ fontSize: scaledPx(14), color: colors.accent, marginTop: scaledPx(2) }}>{header.title}</p>
          ) : null}
          {header.contact_items.length > 0 ? (
            <p style={{ fontSize: scaledPx(11), color: colors.muted, marginTop: scaledPx(6) }}>{header.contact_items.join(" • ")}</p>
          ) : null}
          {header.social_links.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {header.social_links.map((link) => {
                const Icon = getSocialIcon(link.type);
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target={mode === "thumbnail" ? undefined : "_blank"}
                    rel={mode === "thumbnail" ? undefined : "noreferrer"}
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: scaledPx(11), color: colors.muted, textDecoration: "underline", pointerEvents: mode === "thumbnail" ? "none" : "auto" }}
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

      <div style={{ height: "1px", background: `${colors.muted}33`, marginTop: scaledPx(12), marginBottom: scaledPx(14) }} />

      {theme.mode === "portfolio-two-column" ? (
        <div className="grid gap-5" style={{ gridTemplateColumns: `${scaledPx(170)} 1fr` }}>
          <aside
            style={{
              background: `${colors.accent}0d`,
              border: `1px solid ${colors.accent}2c`,
              borderRadius: scaledPx(10),
              padding: scaledPx(12)
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
