import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  spacingScale?: number;
  layoutScale?: number;
  mode?: PreviewMode;
  onPageCountChange?: (pageCount: number) => void;
}

const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.15;
const MIN_SPACING_SCALE = 0.7;
const MAX_SPACING_SCALE = 1.4;
const MIN_LAYOUT_SCALE = 0.7;
const MAX_LAYOUT_SCALE = 1.3;

const PAGE_WIDTH_PX = 595;
const PAGE_HEIGHT_PX = 842;
const PAGE_GAP_PX = 24;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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
  spacingScale = 1,
  layoutScale = 1,
  mode = "full",
  onPageCountChange
}: CVPresentationPreviewProps) {
  const resolvedFontScale = clamp(fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
  const resolvedSpacingScale = clamp(spacingScale, MIN_SPACING_SCALE, MAX_SPACING_SCALE);
  const resolvedLayoutScale = clamp(layoutScale, MIN_LAYOUT_SCALE, MAX_LAYOUT_SCALE);

  const measureRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>(PAGE_HEIGHT_PX);

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) {
      return;
    }

    const update = () => {
      const next = node.getBoundingClientRect().height;
      if (next > 0) {
        setContentHeight(next);
      }
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(node);

    return () => observer.disconnect();
  }, [presentation, mode, resolvedFontScale, resolvedSpacingScale, resolvedLayoutScale]);

  const rootScaleStyle = {
    "--cv-font-scale": String(resolvedFontScale)
  } as React.CSSProperties;

  if (!presentation) {
    return (
      <div
        className={mode === "thumbnail" ? "bg-white shadow-sm" : "bg-white shadow-lg"}
        style={{
          ...rootScaleStyle,
          width: `${PAGE_WIDTH_PX}px`,
          minHeight: `${PAGE_HEIGHT_PX}px`,
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

  const scaledSectionSpacing = tokens.section_spacing * resolvedSpacingScale;
  const scaledBlockSpacing = tokens.block_spacing * resolvedSpacingScale;

  const basePadY = theme.mode === "compact-single-column" ? 38 : 46;
  const basePadX = theme.mode === "compact-single-column" ? 34 : 38;
  const padY = basePadY * resolvedLayoutScale;
  const padX = basePadX * resolvedLayoutScale;

  const header = presentation.header;
  const sideSectionTypes = new Set(["skills", "languages", "references", "certifications", "courses"]);
  const sidebarSections = presentation.sections.filter((section) => sideSectionTypes.has(section.type));
  const mainSections = presentation.sections.filter((section) => !sideSectionTypes.has(section.type));

  const renderInner = () => (
    <>
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
              renderDefaultSection(section, colors, Math.max(10, scaledSectionSpacing - 3), Math.max(6, scaledBlockSpacing - 3))
            )}
          </aside>

          <main>
            {mainSections.map((section) =>
              renderDefaultSection(section, colors, scaledSectionSpacing, scaledBlockSpacing)
            )}
          </main>
        </div>
      ) : theme.mode === "timeline-split" ? (
        <div>
          {presentation.sections.map((section) => renderTimelineSection(section, colors, scaledSectionSpacing, scaledBlockSpacing))}
        </div>
      ) : (
        <div>
          {presentation.sections.map((section) => renderDefaultSection(section, colors, scaledSectionSpacing, scaledBlockSpacing))}
        </div>
      )}
    </>
  );

  const sheetBaseStyle: React.CSSProperties = {
    width: `${PAGE_WIDTH_PX}px`,
    fontFamily: tokens.font_family,
    background: tokens.page_background_hex,
    color: colors.body,
    boxSizing: "border-box"
  };

  const sheetPaddingStyle: React.CSSProperties = {
    paddingTop: scaledPx(padY),
    paddingBottom: scaledPx(padY),
    paddingLeft: scaledPx(padX),
    paddingRight: scaledPx(padX)
  };

  if (mode === "thumbnail") {
    return (
      <div
        className="shadow-sm"
        style={{
          ...rootScaleStyle,
          ...sheetBaseStyle,
          ...sheetPaddingStyle,
          minHeight: `${PAGE_HEIGHT_PX}px`
        }}
      >
        {renderInner()}
      </div>
    );
  }

  const pagedContentHeight = Math.max(1, contentHeight - padY);
  const pageCount = Math.max(1, Math.ceil((pagedContentHeight + 0.5) / PAGE_HEIGHT_PX));

  return (
    <div style={{ ...rootScaleStyle, position: "relative" }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-99999px",
          top: 0,
          width: `${PAGE_WIDTH_PX}px`,
          visibility: "hidden",
          pointerEvents: "none"
        }}
      >
        <div ref={measureRef} style={{ ...sheetBaseStyle, ...sheetPaddingStyle }}>
          {renderInner()}
        </div>
      </div>

      <PageCountReporter pageCount={pageCount} onChange={onPageCountChange} />

      <div className="flex flex-col items-center" style={{ gap: `${PAGE_GAP_PX}px` }}>
        {Array.from({ length: pageCount }).map((_, pageIndex) => (
          <div
            key={pageIndex}
            className="shadow-lg"
            style={{
              ...sheetBaseStyle,
              height: `${PAGE_HEIGHT_PX}px`,
              overflow: "hidden",
              position: "relative"
            }}
          >
            <div
              style={{
                ...sheetPaddingStyle,
                position: "absolute",
                top: `${-pageIndex * PAGE_HEIGHT_PX}px`,
                left: 0,
                right: 0,
                width: "100%",
                boxSizing: "border-box"
              }}
            >
              {renderInner()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageCountReporter({
  pageCount,
  onChange
}: {
  pageCount: number;
  onChange?: (pageCount: number) => void;
}) {
  useEffect(() => {
    onChange?.(pageCount);
  }, [pageCount, onChange]);

  return null;
}
