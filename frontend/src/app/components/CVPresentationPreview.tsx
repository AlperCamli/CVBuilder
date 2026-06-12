import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { Globe, Github, Linkedin } from "lucide-react";
import type {
  PresentationHeader,
  PresentationItem,
  PresentationSection,
  PresentationTheme,
  RenderingPresentation
} from "../integration/api-types";
import { PLACEHOLDER_OPEN, PLACEHOLDER_SEGMENT_RE } from "../integration/preview-placeholders";

type PreviewMode = "full" | "thumbnail";

interface CVPresentationPreviewProps {
  presentation: RenderingPresentation | null;
  fontScale?: number;
  spacingScale?: number;
  layoutScale?: number;
  mode?: PreviewMode;
  onPageCountChange?: (pageCount: number) => void;
}

const MIN_FONT_SCALE = 0.7;
const MAX_FONT_SCALE = 1.15;
const MIN_SPACING_SCALE = 0.5;
const MAX_SPACING_SCALE = 1.4;
const MIN_LAYOUT_SCALE = 0.5;
const MAX_LAYOUT_SCALE = 1.3;

// A4 at 72dpi (PDF points) — matches the backend PDF page size exactly.
const PAGE_WIDTH_PX = 595;
const PAGE_HEIGHT_PX = 842;
const PAGE_GAP_PX = 24;
const TWO_COLUMN_GAP_PX = 20;
const SIDEBAR_OUTER_WIDTH = 170;
const SIDEBAR_INNER_PADDING = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const scaledPx = (px: number): string => `calc(${px}px * var(--cv-font-scale))`;

interface PreviewColors {
  heading: string;
  accent: string;
  body: string;
  muted: string;
}

type BlockColumn = "full" | "sidebar" | "main";

interface BlockSpec {
  key: string;
  node: ReactNode;
  column: BlockColumn;
  /**
   * When true, this block must stay together with the next block on the same page.
   * Used for section titles so they never get orphaned at the bottom of a page.
   */
  keepWithNext?: boolean;
}

interface BuiltPresentation {
  theme: PresentationTheme;
  colors: PreviewColors;
  padX: number;
  padY: number;
  innerWidth: number;
  innerHeight: number;
  isTwoColumn: boolean;
  isTimeline: boolean;
  headerBlocks: BlockSpec[];
  sidebarBlocks: BlockSpec[];
  mainBlocks: BlockSpec[];
  singleBlocks: BlockSpec[];
  sheetBaseStyle: CSSProperties;
  sheetPaddingStyle: CSSProperties;
  sidebarInnerWidth: number;
  mainColumnWidth: number;
  sidebarPadY: number;
}

interface SinglePage {
  kind: "single";
  blocks: BlockSpec[];
}

interface TwoColumnPageSpec {
  kind: "two-column";
  header: BlockSpec[];
  sidebar: BlockSpec[];
  main: BlockSpec[];
}

type PageSpec = SinglePage | TwoColumnPageSpec;

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

// Placeholder segments (wrapped in ⟪…⟫ by preview-placeholders.ts before the preview
// request) render with lower contrast so users see where each field lands on the template
// before writing. Real content contains no markers and passes through unchanged.
const renderPreviewText = (text: string): ReactNode => {
  if (!text.includes(PLACEHOLDER_OPEN)) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(PLACEHOLDER_SEGMENT_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(
      <span key={`ph-${key++}`} style={{ opacity: 0.4, fontStyle: "italic" }}>
        {match[1]}
      </span>
    );
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

// Body (lead paragraph / labeled detail lines) and bullets render together: items mapped
// from bullet-edited narrative fields carry both, and dropping either loses content.
const renderItemBody = (item: PresentationItem, bodyColor: string): ReactNode => {
  if (item.bullets.length === 0 && !item.body) {
    return null;
  }

  return (
    <>
      {item.body ? (
        <p
          style={{
            fontSize: scaledPx(12),
            lineHeight: 1.6,
            color: bodyColor,
            whiteSpace: "pre-line",
            marginTop: scaledPx(4)
          }}
        >
          {renderPreviewText(item.body)}
        </p>
      ) : null}
      {item.bullets.length > 0 ? (
        <ul className="mt-1" style={{ paddingLeft: scaledPx(16), color: bodyColor, listStyle: "disc" }}>
          {item.bullets.map((bullet, index) => (
            <li key={`${item.id}-bullet-${index}`} style={{ fontSize: scaledPx(12), lineHeight: 1.5 }}>
              {renderPreviewText(bullet)}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

function SectionTitle({ title, color }: { title: string; color: string }) {
  return (
    <h2 style={{ fontSize: scaledPx(14), fontWeight: 600, color, marginBottom: scaledPx(8) }}>
      {title}
    </h2>
  );
}

function DefaultItemBody({ item, colors }: { item: PresentationItem; colors: PreviewColors }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          {item.title ? (
            <h3 style={{ fontSize: scaledPx(13), fontWeight: 600, color: colors.heading }}>
              {renderPreviewText(item.title)}
            </h3>
          ) : null}
          {item.subtitle ? (
            <p style={{ fontSize: scaledPx(12), color: colors.body }}>{renderPreviewText(item.subtitle)}</p>
          ) : null}
        </div>
        {item.metadata_line || item.date_range ? (
          <span style={{ fontSize: scaledPx(11), color: colors.muted, textAlign: "right" }}>
            {renderPreviewText(item.metadata_line || item.date_range || "")}
          </span>
        ) : null}
      </div>
      {renderItemBody(item, colors.body)}
    </div>
  );
}

function TimelineItemBody({ item, colors }: { item: PresentationItem; colors: PreviewColors }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `${scaledPx(110)} 1fr` }}>
      <div style={{ fontSize: scaledPx(11), color: colors.muted, paddingTop: scaledPx(2) }}>
        {renderPreviewText(item.metadata_line || item.date_range || "")}
      </div>
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
        {item.title ? (
          <h3 style={{ fontSize: scaledPx(13), fontWeight: 600, color: colors.heading }}>
            {renderPreviewText(item.title)}
          </h3>
        ) : null}
        {item.subtitle ? (
          <p style={{ fontSize: scaledPx(12), color: colors.body }}>{renderPreviewText(item.subtitle)}</p>
        ) : null}
        {renderItemBody(item, colors.body)}
      </div>
    </div>
  );
}

function buildSectionBlocks(
  section: PresentationSection,
  options: {
    colors: PreviewColors;
    style: "default" | "timeline";
    blockSpacing: number;
    sectionSpacing: number;
    column: BlockColumn;
    keyPrefix: string;
  }
): BlockSpec[] {
  const { colors, style, blockSpacing, sectionSpacing, column, keyPrefix } = options;
  const blocks: BlockSpec[] = [];

  // Section with no items: bundle title + inline text (if any) as a single, indivisible block.
  if (section.items.length === 0) {
    blocks.push({
      key: `${keyPrefix}sec-${section.id}`,
      column,
      node: (
        <div style={{ marginBottom: scaledPx(sectionSpacing) }}>
          <SectionTitle title={section.title} color={colors.heading} />
          {section.inline_text ? (
            <p style={{ fontSize: scaledPx(12), lineHeight: 1.6, color: colors.body }}>
              {renderPreviewText(section.inline_text)}
            </p>
          ) : null}
        </div>
      )
    });
    return blocks;
  }

  blocks.push({
    key: `${keyPrefix}sec-${section.id}-title`,
    column,
    keepWithNext: true,
    node: <SectionTitle title={section.title} color={colors.heading} />
  });

  if (section.inline_text) {
    blocks.push({
      key: `${keyPrefix}sec-${section.id}-inline`,
      column,
      keepWithNext: true,
      node: (
        <p
          style={{
            fontSize: scaledPx(12),
            lineHeight: 1.6,
            color: colors.body,
            marginBottom: scaledPx(blockSpacing)
          }}
        >
          {renderPreviewText(section.inline_text)}
        </p>
      )
    });
  }

  section.items.forEach((item, index) => {
    const isLast = index === section.items.length - 1;
    const trailingMargin = isLast ? sectionSpacing : blockSpacing;
    blocks.push({
      key: `${keyPrefix}item-${item.id}`,
      column,
      node: (
        <div style={{ marginBottom: scaledPx(trailingMargin) }}>
          {style === "timeline" ? (
            <TimelineItemBody item={item} colors={colors} />
          ) : (
            <DefaultItemBody item={item} colors={colors} />
          )}
        </div>
      )
    });
  });

  return blocks;
}

function buildHeaderBlocks(
  header: PresentationHeader,
  theme: PresentationTheme,
  colors: PreviewColors,
  mode: PreviewMode
): BlockSpec[] {
  const blocks: BlockSpec[] = [];

  blocks.push({
    key: "header-main",
    column: "full",
    node: (
      <div className="flex items-start gap-4">
        {header.photo ? (
          <img
            src={header.photo}
            alt="Profile"
            style={{
              width: scaledPx(58),
              height: scaledPx(58),
              borderRadius: header.photo_shape === "square" ? "0px" : "999px",
              objectFit: "cover",
              flexShrink: 0
            }}
          />
        ) : null}

        <div className="flex-1 min-w-0">
          <h1
            style={{
              fontSize: theme.mode === "compact-single-column" ? scaledPx(21) : scaledPx(23),
              color: colors.heading,
              fontWeight: 600
            }}
          >
            {header.name ? renderPreviewText(header.name) : "Your Name"}
          </h1>
          {header.title ? (
            <p style={{ fontSize: scaledPx(14), color: colors.accent, marginTop: scaledPx(2) }}>
              {renderPreviewText(header.title)}
            </p>
          ) : null}
          {header.contact_items.length > 0 ? (
            <p style={{ fontSize: scaledPx(11), color: colors.muted, marginTop: scaledPx(6) }}>
              {renderPreviewText(header.contact_items.join(" • "))}
            </p>
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
                    style={{
                      fontSize: scaledPx(11),
                      color: colors.muted,
                      textDecoration: "underline",
                      pointerEvents: mode === "thumbnail" ? "none" : "auto"
                    }}
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
    )
  });

  blocks.push({
    key: "header-divider",
    column: "full",
    node: (
      <div
        style={{
          height: "1px",
          background: `${colors.muted}33`,
          marginTop: scaledPx(12),
          marginBottom: scaledPx(14)
        }}
      />
    )
  });

  return blocks;
}

/**
 * Walk the block list and pack blocks into pages. A block is never split across pages.
 * If a block flagged keepWithNext can't fit alongside the next block, both are pushed
 * to the next page so the section title never gets orphaned.
 *
 * `availableHeights[i]` is the usable content height for page index i. If the array
 * is shorter than the number of pages needed, the last entry is reused for all
 * subsequent pages.
 */
function paginateBlocks(
  blocks: BlockSpec[],
  heights: Map<string, number>,
  availableHeights: number[]
): BlockSpec[][] {
  const pages: BlockSpec[][] = [[]];
  let cursorY = 0;

  const getAvailable = (pageIndex: number): number => {
    if (availableHeights.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    const idx = Math.min(pageIndex, availableHeights.length - 1);
    return availableHeights[idx];
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockHeight = heights.get(block.key) ?? 0;
    const pageIdx = pages.length - 1;
    const available = getAvailable(pageIdx);

    let neededHeight = blockHeight;
    if (block.keepWithNext && i + 1 < blocks.length) {
      const nextHeight = heights.get(blocks[i + 1].key) ?? 0;
      // Don't demand more than fits on a fresh page; otherwise we'd create infinite breaks.
      neededHeight = Math.min(available, blockHeight + nextHeight);
    }

    const pageHasContent = pages[pageIdx].length > 0;
    const wouldOverflow = cursorY + neededHeight > available + 0.5;

    if (wouldOverflow && pageHasContent) {
      pages.push([]);
      cursorY = 0;
    }

    pages[pages.length - 1].push(block);
    cursorY += blockHeight;
  }

  return pages;
}

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

  const rootScaleStyle = { "--cv-font-scale": String(resolvedFontScale) } as CSSProperties;

  const measurementRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const heightsRef = useRef<Map<string, number>>(new Map());
  const [heightsVersion, setHeightsVersion] = useState(0);

  const built = useMemo<BuiltPresentation | null>(() => {
    if (!presentation) {
      return null;
    }

    const theme = presentation.theme;
    const tokens = theme.tokens;
    const colors: PreviewColors = {
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
    const innerWidth = PAGE_WIDTH_PX - padX * 2;
    const innerHeight = PAGE_HEIGHT_PX - padY * 2;

    const isTwoColumn = theme.mode === "portfolio-two-column";
    const isTimeline = theme.mode === "timeline-split";

    const sidebarOuterWidth = SIDEBAR_OUTER_WIDTH * resolvedFontScale;
    const sidebarPadY = SIDEBAR_INNER_PADDING * resolvedFontScale;
    const sidebarPadX = SIDEBAR_INNER_PADDING * resolvedFontScale;
    const sidebarInnerWidth = Math.max(0, sidebarOuterWidth - sidebarPadX * 2);
    const mainColumnWidth = Math.max(0, innerWidth - sidebarOuterWidth - TWO_COLUMN_GAP_PX);

    const headerBlocks = buildHeaderBlocks(presentation.header, theme, colors, mode);

    let sidebarBlocks: BlockSpec[] = [];
    let mainBlocks: BlockSpec[] = [];
    let singleBlocks: BlockSpec[] = [];

    if (isTwoColumn) {
      const sideSectionTypes = new Set(["skills", "languages", "references", "certifications", "courses"]);
      const sidebarSections = presentation.sections.filter((s) => sideSectionTypes.has(s.type));
      const mainSections = presentation.sections.filter((s) => !sideSectionTypes.has(s.type));

      const sidebarColors: PreviewColors = { ...colors, heading: colors.accent };

      sidebarBlocks = sidebarSections.flatMap((section) =>
        buildSectionBlocks(section, {
          colors: sidebarColors,
          style: "default",
          blockSpacing: Math.max(6, scaledBlockSpacing - 3),
          sectionSpacing: Math.max(10, scaledSectionSpacing - 3),
          column: "sidebar",
          keyPrefix: "sb-"
        })
      );

      mainBlocks = mainSections.flatMap((section) =>
        buildSectionBlocks(section, {
          colors,
          style: "default",
          blockSpacing: scaledBlockSpacing,
          sectionSpacing: scaledSectionSpacing,
          column: "main",
          keyPrefix: "mn-"
        })
      );
    } else {
      singleBlocks = presentation.sections.flatMap((section) =>
        buildSectionBlocks(section, {
          colors,
          style: isTimeline ? "timeline" : "default",
          blockSpacing: scaledBlockSpacing,
          sectionSpacing: scaledSectionSpacing,
          column: "full",
          keyPrefix: ""
        })
      );
    }

    const sheetBaseStyle: CSSProperties = {
      width: `${PAGE_WIDTH_PX}px`,
      fontFamily: tokens.font_family,
      background: tokens.page_background_hex,
      color: colors.body,
      boxSizing: "border-box"
    };

    const sheetPaddingStyle: CSSProperties = {
      paddingTop: `${padY}px`,
      paddingBottom: `${padY}px`,
      paddingLeft: `${padX}px`,
      paddingRight: `${padX}px`
    };

    return {
      theme,
      colors,
      padX,
      padY,
      innerWidth,
      innerHeight,
      isTwoColumn,
      isTimeline,
      headerBlocks,
      sidebarBlocks,
      mainBlocks,
      singleBlocks,
      sheetBaseStyle,
      sheetPaddingStyle,
      sidebarInnerWidth,
      mainColumnWidth,
      sidebarPadY
    };
  }, [presentation, resolvedFontScale, resolvedSpacingScale, resolvedLayoutScale, mode]);

  const allMeasurementBlocks = useMemo<BlockSpec[]>(() => {
    if (!built) {
      return [];
    }
    return [...built.headerBlocks, ...built.singleBlocks, ...built.sidebarBlocks, ...built.mainBlocks];
  }, [built]);

  useLayoutEffect(() => {
    if (mode === "thumbnail" || !built) {
      return;
    }

    const refs = measurementRefs.current;

    const measureAll = () => {
      const next = new Map<string, number>();
      refs.forEach((el, key) => {
        next.set(key, el.getBoundingClientRect().height);
      });

      let changed = next.size !== heightsRef.current.size;
      if (!changed) {
        for (const [key, value] of next) {
          const prev = heightsRef.current.get(key) ?? 0;
          if (Math.abs(prev - value) > 0.5) {
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        heightsRef.current = next;
        setHeightsVersion((v) => v + 1);
      }
    };

    measureAll();

    const observer = new ResizeObserver(() => measureAll());
    refs.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [allMeasurementBlocks, mode, built]);

  const pages = useMemo<PageSpec[]>(() => {
    if (!built) {
      return [];
    }
    // Reading heightsVersion ensures recomputation when measurements change.
    void heightsVersion;
    const heights = heightsRef.current;
    const innerHeight = built.innerHeight;

    if (built.isTwoColumn) {
      const headerHeight = built.headerBlocks.reduce(
        (sum, block) => sum + (heights.get(block.key) ?? 0),
        0
      );

      const sidebarPadConsumed = built.sidebarPadY * 2;
      const sidebarPage1 = Math.max(0, innerHeight - headerHeight - sidebarPadConsumed);
      const sidebarPageN = Math.max(0, innerHeight - sidebarPadConsumed);
      const mainPage1 = Math.max(0, innerHeight - headerHeight);
      const mainPageN = innerHeight;

      const sidebarPages = paginateBlocks(built.sidebarBlocks, heights, [sidebarPage1, sidebarPageN]);
      const mainPages = paginateBlocks(built.mainBlocks, heights, [mainPage1, mainPageN]);

      const pageCount = Math.max(sidebarPages.length, mainPages.length, 1);
      const result: PageSpec[] = [];
      for (let i = 0; i < pageCount; i++) {
        result.push({
          kind: "two-column",
          header: i === 0 ? built.headerBlocks : [],
          sidebar: sidebarPages[i] ?? [],
          main: mainPages[i] ?? []
        });
      }
      return result;
    }

    const combined = [...built.headerBlocks, ...built.singleBlocks];
    const paged = paginateBlocks(combined, heights, [innerHeight]);
    return paged.map<PageSpec>((blocks) => ({ kind: "single", blocks }));
  }, [built, heightsVersion]);

  const pageCount = pages.length || 1;

  useEffect(() => {
    if (!onPageCountChange) {
      return;
    }
    if (mode === "thumbnail") {
      onPageCountChange(1);
      return;
    }
    onPageCountChange(pageCount);
  }, [pageCount, onPageCountChange, mode]);

  if (!presentation || !built) {
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

  // Thumbnail: render everything inside a single A4 sheet without pagination;
  // overflow is clipped, matching the existing template-gallery behavior.
  if (mode === "thumbnail") {
    return (
      <div
        className="shadow-sm"
        style={{
          ...rootScaleStyle,
          ...built.sheetBaseStyle,
          ...built.sheetPaddingStyle,
          minHeight: `${PAGE_HEIGHT_PX}px`,
          overflow: "hidden"
        }}
      >
        {built.headerBlocks.map((block) => (
          <div key={block.key}>{block.node}</div>
        ))}
        {built.isTwoColumn ? (
          <div
            className="grid"
            style={{ gridTemplateColumns: `${scaledPx(SIDEBAR_OUTER_WIDTH)} 1fr`, gap: `${TWO_COLUMN_GAP_PX}px` }}
          >
            <aside
              style={{
                background: `${built.colors.accent}0d`,
                border: `1px solid ${built.colors.accent}2c`,
                borderRadius: scaledPx(10),
                padding: scaledPx(SIDEBAR_INNER_PADDING)
              }}
            >
              {built.sidebarBlocks.map((block) => (
                <div key={block.key}>{block.node}</div>
              ))}
            </aside>
            <main>
              {built.mainBlocks.map((block) => (
                <div key={block.key}>{block.node}</div>
              ))}
            </main>
          </div>
        ) : (
          <div>
            {built.singleBlocks.map((block) => (
              <div key={block.key}>{block.node}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const setBlockRef = (key: string) => (el: HTMLDivElement | null) => {
    const map = measurementRefs.current;
    if (el) {
      map.set(key, el);
    } else {
      map.delete(key);
    }
  };

  return (
    <div style={{ ...rootScaleStyle, position: "relative" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-99999px",
          top: 0,
          visibility: "hidden",
          pointerEvents: "none",
          fontFamily: built.theme.tokens.font_family
        }}
      >
        {built.headerBlocks.map((block) => (
          <div
            key={`m-${block.key}`}
            ref={setBlockRef(block.key)}
            style={{ width: `${built.innerWidth}px`, display: "flow-root" }}
          >
            {block.node}
          </div>
        ))}
        {built.singleBlocks.map((block) => (
          <div
            key={`m-${block.key}`}
            ref={setBlockRef(block.key)}
            style={{ width: `${built.innerWidth}px`, display: "flow-root" }}
          >
            {block.node}
          </div>
        ))}
        {built.sidebarBlocks.map((block) => (
          <div
            key={`m-${block.key}`}
            ref={setBlockRef(block.key)}
            style={{ width: `${built.sidebarInnerWidth}px`, display: "flow-root" }}
          >
            {block.node}
          </div>
        ))}
        {built.mainBlocks.map((block) => (
          <div
            key={`m-${block.key}`}
            ref={setBlockRef(block.key)}
            style={{ width: `${built.mainColumnWidth}px`, display: "flow-root" }}
          >
            {block.node}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center" style={{ gap: `${PAGE_GAP_PX}px` }}>
        {pages.map((page, pageIndex) => (
          <div
            key={pageIndex}
            className="shadow-lg"
            style={{
              ...built.sheetBaseStyle,
              height: `${PAGE_HEIGHT_PX}px`,
              overflow: "hidden",
              position: "relative"
            }}
          >
            <div style={{ ...built.sheetPaddingStyle, height: "100%", boxSizing: "border-box" }}>
              {page.kind === "two-column" ? (
                <TwoColumnPageContent page={page} built={built} />
              ) : (
                <div>
                  {page.blocks.map((block) => (
                    <div key={block.key}>{block.node}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TwoColumnPageContent({
  page,
  built
}: {
  page: TwoColumnPageSpec;
  built: BuiltPresentation;
}) {
  return (
    <>
      {page.header.map((block) => (
        <div key={block.key}>{block.node}</div>
      ))}
      <div
        className="grid"
        style={{ gridTemplateColumns: `${scaledPx(SIDEBAR_OUTER_WIDTH)} 1fr`, gap: `${TWO_COLUMN_GAP_PX}px` }}
      >
        <aside
          style={{
            background: `${built.colors.accent}0d`,
            border: `1px solid ${built.colors.accent}2c`,
            borderRadius: scaledPx(10),
            padding: scaledPx(SIDEBAR_INNER_PADDING)
          }}
        >
          {page.sidebar.map((block) => (
            <div key={block.key}>{block.node}</div>
          ))}
        </aside>
        <main>
          {page.main.map((block) => (
            <div key={block.key}>{block.node}</div>
          ))}
        </main>
      </div>
    </>
  );
}
