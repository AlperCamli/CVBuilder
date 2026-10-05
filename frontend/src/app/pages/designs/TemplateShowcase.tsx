import { useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, Expand, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Eyebrow, StartLink } from "./DesignShared";
import {
  SHOWCASE_TEMPLATES as templates,
  type ShowcaseDirection,
  type ShowcaseTemplate,
} from "./template-showcase-data";
import "./template-showcase.css";

const palette = (template: ShowcaseTemplate): CSSProperties =>
  ({
    "--ts-ink": template.ink,
    "--ts-accent": template.accent,
    "--ts-surface": template.surface,
  }) as CSSProperties;

function Paper({
  template,
  eager = false,
}: {
  template: ShowcaseTemplate;
  eager?: boolean;
}) {
  return (
    <img
      className="ts-paper"
      src={template.image}
      width="1000"
      height="1415"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      alt={`${template.name} CV template in ${template.color.toLowerCase()}, showing a fictional product designer’s experience.`}
    />
  );
}

function Swatch({ template }: { template: ShowcaseTemplate }) {
  return (
    <span className="ts-swatch" style={palette(template)} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function TemplateShowcase({
  direction,
  onOverlayChange,
}: {
  direction: ShowcaseDirection;
  onOverlayChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const current = templates[selected];
  const advance = (delta: number) =>
    setSelected(
      (index) => (index + delta + templates.length) % templates.length,
    );
  const openPreview = (index: number) => {
    opener.current = document.activeElement as HTMLElement | null;
    setPreview(index);
    onOverlayChange(true);
  };
  const closePreview = () => {
    setPreview(null);
    onOverlayChange(false);
  };
  const controls = (
    <div className="ts-arrows">
      <button onClick={() => advance(-1)} aria-label="Previous template">
        <ArrowLeft size={19} />
      </button>
      <span aria-live="polite" aria-atomic="true">
        {String(selected + 1).padStart(2, "0")} <span>/ 07</span>
      </span>
      <button onClick={() => advance(1)} aria-label="Next template">
        <ArrowRight size={19} />
      </button>
    </div>
  );

  return (
    <>
      <section
        className={`ts-showcase ts-${direction}`}
        id="templates"
        aria-labelledby="ts-heading"
      >
        <div className="cv-wrap ts-inner">
          {direction === "collection" && (
            <>
              <header className="ts-section-heading">
                <div>
                  <Eyebrow>A GOOD FIRST IMPRESSION</Eyebrow>
                  <h2 id="ts-heading">
                    Your experience.
                    <br />
                    <em>Your kind of style.</em>
                  </h2>
                </div>
                <p>
                  Find a look that feels like you.
                  <br />
                  Make it yours in the editor.
                </p>
              </header>
              <div className="ts-collection-grid">
                {templates.map((template, index) => (
                  <button
                    className="ts-collection-card"
                    key={template.slug}
                    style={palette(template)}
                    onClick={() => openPreview(index)}
                    aria-label={`Preview ${template.name}`}
                  >
                    <span className="ts-card-stage">
                      <Paper template={template} />
                      <span className="ts-expand">
                        <Expand size={15} /> Take a closer look
                      </span>
                    </span>
                    <span className="ts-card-label">
                      <span>
                        <strong>{template.name}</strong>
                        <small>{template.color}</small>
                      </span>
                      <Swatch template={template} />
                    </span>
                  </button>
                ))}
                <div className="ts-collection-invite">
                  <span className="ts-invite-icon">
                    <FileText size={27} strokeWidth={1.4} />
                  </span>
                  <h3>
                    The next one
                    <br />
                    could be yours.
                  </h3>
                  <p>Your story. A fresh start.</p>
                  <StartLink className="cv-text-link">
                    Create my CV <ArrowRight size={17} />
                  </StartLink>
                  <small>Free to start. No card required.</small>
                </div>
              </div>
            </>
          )}

          {direction === "spotlight" && (
            <div className="ts-spotlight-layout">
              <div className="ts-spotlight-stage" style={palette(current)}>
                <span className="ts-stage-caption">
                  <span>THE TEMPLATE COLLECTION</span>
                  <span>0{selected + 1} / 07</span>
                </span>
                <button
                  className="ts-spotlight-paper"
                  onClick={() => openPreview(selected)}
                  aria-label={`Enlarge ${current.name}`}
                >
                  <Paper template={current} eager />
                  <span className="ts-expand">
                    <Expand size={15} /> View full size
                  </span>
                </button>
                <div className="ts-stage-footer">
                  <span>{current.color}</span>
                  {controls}
                </div>
              </div>
              <div className="ts-spotlight-copy">
                <Eyebrow>SAME STORY. A NEW PERSPECTIVE.</Eyebrow>
                <h2 id="ts-heading">
                  Find your
                  <br />
                  <em>signature style.</em>
                </h2>
                <p>
                  A little color or quietly classic.
                  <br />
                  Your CV should feel like you.
                </p>
                <div
                  className="ts-picker"
                  role="group"
                  aria-label="Choose a template to preview"
                >
                  {templates.map((template, index) => (
                    <button
                      key={template.slug}
                      onClick={() => setSelected(index)}
                      aria-pressed={selected === index}
                    >
                      <Swatch template={template} />
                      <span>{template.name}</span>
                      {selected === index && <Check size={16} />}
                    </button>
                  ))}
                </div>
                <div
                  className="ts-selected-caption"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <strong>{current.name}</strong>
                  <p>{current.detail}</p>
                </div>
                <StartLink>
                  Create my CV <ArrowRight size={17} />
                </StartLink>
                <small className="ts-free-note">
                  Free to start. Make it yours in the editor.
                </small>
              </div>
            </div>
          )}

          {direction === "lookbook" && (
            <>
              <header className="ts-section-heading ts-centered">
                <Eyebrow>DRESSED FOR YOUR NEXT CHAPTER</Eyebrow>
                <h2 id="ts-heading">
                  Good on paper.
                  <br />
                  <em>Even better when it’s yours.</em>
                </h2>
                <p>
                  Seven different looks. Your experience at the heart of each.
                </p>
              </header>
              <div
                className="ts-deck"
                role="region"
                aria-roledescription="carousel"
                aria-label="CV template lookbook"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    advance(event.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
                onPointerDown={(event) => {
                  pointer.current = { x: event.clientX, y: event.clientY };
                  swiped.current = false;
                }}
                onPointerUp={(event) => {
                  if (!pointer.current) return;
                  const dx = event.clientX - pointer.current.x,
                    dy = event.clientY - pointer.current.y;
                  pointer.current = null;
                  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    swiped.current = true;
                    advance(dx < 0 ? 1 : -1);
                  }
                }}
                onPointerCancel={() => {
                  pointer.current = null;
                }}
                onClickCapture={(event) => {
                  if (swiped.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    swiped.current = false;
                  }
                }}
              >
                <span className="ts-deck-orbit" aria-hidden="true" />
                {templates.map((template, index) => {
                  let offset =
                    (index - selected + templates.length) % templates.length;
                  if (offset > 3) offset -= templates.length;
                  return (
                    <button
                      key={template.slug}
                      className={`ts-deck-card ${offset === 0 ? "is-selected" : ""}`}
                      style={
                        {
                          ...palette(template),
                          "--offset": offset,
                          "--distance": Math.abs(offset),
                          zIndex: 5 - Math.abs(offset),
                        } as CSSProperties
                      }
                      data-offset={offset}
                      aria-hidden={Math.abs(offset) > 2}
                      tabIndex={Math.abs(offset) > 2 ? -1 : 0}
                      onClick={() =>
                        offset === 0 ? openPreview(index) : setSelected(index)
                      }
                      aria-label={
                        offset === 0
                          ? `Enlarge ${template.name}`
                          : `Show ${template.name}`
                      }
                    >
                      <Paper template={template} />
                      <span className="ts-deck-label">
                        {template.name}
                        <Expand size={14} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="ts-lookbook-caption">
                <div aria-live="polite" aria-atomic="true">
                  <h3>{current.name}</h3>
                  <p>{current.detail}</p>
                </div>
                {controls}
              </div>
              <div
                className="ts-lookbook-picker"
                role="group"
                aria-label="Choose a lookbook template"
              >
                {templates.map((template, index) => (
                  <button
                    key={template.slug}
                    onClick={() => setSelected(index)}
                    aria-pressed={selected === index}
                  >
                    <Swatch template={template} />
                    <span>{template.name}</span>
                  </button>
                ))}
              </div>
              <div className="ts-lookbook-cta">
                <StartLink>
                  Make it yours <ArrowRight size={17} />
                </StartLink>
                <span>Free to start. Choose your style in the editor.</span>
              </div>
            </>
          )}
          <p className="ts-sample-note">
            Real templates. Fictional details. Your experience takes their
            place.
          </p>
        </div>
      </section>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent
          className="ts-preview-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle>{templates[preview ?? selected].name}</DialogTitle>
            <DialogDescription>
              {templates[preview ?? selected].color} · Fictional sample CV
            </DialogDescription>
          </DialogHeader>
          <div
            className="ts-preview-body"
            style={palette(templates[preview ?? selected])}
          >
            {preview !== null && <Paper template={templates[preview]} eager />}
          </div>
          <div className="ts-preview-footer">
            <span>Choose your template in the CV editor.</span>
            <StartLink className="ts-modal-cta">
              Start free <ArrowRight size={16} />
            </StartLink>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
