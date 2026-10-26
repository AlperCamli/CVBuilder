import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUpToLine, ArrowDownToLine, Check, Copy, Download, GripVertical, RotateCcw, Undo2, X, ZoomIn } from "lucide-react";
import { Link } from "react-router";
import catalog from "./template-order-catalog.json";
import { BALANCED_TEMPLATE_ORDER as balancedOrder } from "../../integration/template-order";
import "./template-order-studio.css";

// Start the requested balanced draft once; subsequent edits persist in this draft.
const STORAGE_KEY = "cv-template-order-studio:v2-balanced";
const initialOrder = [...balancedOrder, ...catalog.map(template => template.slug).filter(slug => !balancedOrder.includes(slug))];
const bySlug = new Map(catalog.map(template => [template.slug, template]));

function loadOrder(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(saved)) {
      const known = [...new Set(saved.filter((slug): slug is string => typeof slug === "string" && bySlug.has(slug)))];
      return [...known, ...initialOrder.filter(slug => !known.includes(slug))];
    }
  } catch { /* A private browser session can still reorder and export. */ }
  return initialOrder;
}

function EdgeMoveButtons({ name, position, count, compact = false, onMove }: {
  name: string; position: number; count: number; compact?: boolean; onMove: (position: number) => void;
}) {
  return <div className={`tos-edge-actions${compact ? " is-compact" : ""}`}>
    <button type="button" disabled={position === 0} onClick={() => onMove(0)} aria-label={`Send ${name} to top`} title="Send to top"><ArrowUpToLine size={13} />{!compact && "Top"}</button>
    <button type="button" disabled={position === count - 1} onClick={() => onMove(count - 1)} aria-label={`Send ${name} to bottom`} title="Send to bottom"><ArrowDownToLine size={13} />{!compact && "Bottom"}</button>
  </div>;
}

export default function TemplateOrderStudio() {
  const [history, setHistory] = useState<string[][]>(() => [loadOrder()]);
  const order = history[history.length - 1];
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [selected, setSelected] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLOListElement>(null);
  const sidebarHandles = useRef(new Map<string, HTMLButtonElement>());
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); setSaved(true); }
    catch { setSaved(false); }
  }, [order]);

  useEffect(() => {
    if (preview) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [preview]);

  // Keep scrolling during a held drag, even when the pointer stops moving.
  useEffect(() => {
    if (!dragged) return;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const track = (event: globalThis.DragEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const speed = (position: number, start: number, end: number) => {
      const edge = Math.min(64, (end - start) / 3);
      if (position < start + edge) return -Math.ceil(18 * Math.min(1, (start + edge - position) / edge));
      if (position > end - edge) return Math.ceil(18 * Math.min(1, (position - end + edge) / edge));
      return 0;
    };
    const scroll = () => {
      if (pointer) {
        const list = sidebarRef.current;
        const bounds = list?.getBoundingClientRect();
        if (list && bounds && pointer.x >= bounds.left && pointer.x <= bounds.right) {
          if (pointer.y >= bounds.top && pointer.y <= bounds.bottom)
            list.scrollTop += speed(pointer.y, bounds.top, bounds.bottom);
        } else {
          const headerHeight = document.querySelector(".tos-header")?.getBoundingClientRect().height ?? 96;
          window.scrollBy(0, speed(pointer.y, headerHeight, window.innerHeight));
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    document.addEventListener("dragover", track);
    frame = requestAnimationFrame(scroll);
    return () => { document.removeEventListener("dragover", track); cancelAnimationFrame(frame); };
  }, [dragged]);

  function startDrag(event: DragEvent, slug: string) {
    if ((event.target as HTMLElement).closest("input")) { event.preventDefault(); return; }
    event.dataTransfer.setData("text/plain", slug);
    event.dataTransfer.effectAllowed = "move";
    setDragged(slug);
  }

  function dragOver(event: DragEvent, slug: string) {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTarget(slug);
  }

  function dropAt(event: DragEvent, position: number) {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain");
    if (dragged && bySlug.has(source)) move(source, position);
    setDragged(null);
    setTarget(null);
  }

  function showCard(slug: string) {
    setSelected(slug);
    document.querySelector(`[data-template-slug="${slug}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function commit(next: string[]) {
    if (next.every((slug, index) => slug === order[index])) return;
    setHistory(previous => [...previous.slice(-39), next]);
  }

  function move(slug: string, to: number) {
    const from = order.indexOf(slug);
    if (from < 0) return;
    const destination = Math.max(0, Math.min(order.length - 1, to));
    const next = order.filter(item => item !== slug);
    next.splice(destination, 0, slug);
    commit(next);
    setMessage(`${bySlug.get(slug)!.name} moved to position ${destination + 1}.`);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, slug: string, index: number, sidebar = false) {
    const columns = sidebar ? 1 : 3;
    const destination = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: order.length - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    move(slug, destination);
    requestAnimationFrame(() => {
      const handle = (sidebar ? sidebarHandles : handles).current.get(slug);
      handle?.focus();
      handle?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function exportText() {
    return JSON.stringify({
      version: 1,
      module_type: "standard",
      template_order: order,
      templates: order.map((slug, index) => ({ position: index + 1, slug, name: bySlug.get(slug)!.name }))
    }, null, 2);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([exportText() + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cv-template-order.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Order exported. Send cv-template-order.json in the chat when you’re ready.");
  }

  async function copy() {
    try { await navigator.clipboard.writeText(exportText()); setMessage("Order copied. Paste it into the chat when you’re ready."); }
    catch { setMessage("Copy is unavailable in this browser. Use Export order to download the JSON file."); }
  }

  return (
    <div className="tos-page" style={{ "--tos-header-height": `${headerHeight}px` } as CSSProperties}>
      <header className="tos-header" ref={headerRef}>
        <div className="tos-header-inner">
          <div className="tos-title-row">
            <Link to="/designs" className="tos-back" aria-label="Back to design studios"><ArrowLeft size={18} /></Link>
            <div><p className="tos-eyebrow">DESIGN STUDIO</p><h1>Template order<span>{order.length}</span></h1></div>
          </div>
          <div className="tos-actions">
            <button onClick={() => { setHistory(previous => previous.length > 1 ? previous.slice(0, -1) : previous); setMessage("Last change undone."); }} disabled={history.length < 2}><Undo2 size={16} />Undo</button>
            <button onClick={() => { commit([...initialOrder]); setMessage("Balanced order restored. You can undo this change."); }}><RotateCcw size={16} />Reset to balanced</button>
            <button onClick={copy}><Copy size={16} />Copy JSON</button>
            <button className="tos-export" onClick={download}><Download size={16} />Export order</button>
          </div>
        </div>
      </header>
      <div className="tos-workspace">
        <aside className="tos-sidebar" aria-label="Quick template ordering">
          <div className="tos-sidebar-heading"><h2>Quick order <span>{order.length}</span></h2><p>Drag rows or type a position number.</p></div>
          <div className="tos-quick-moves">
            <button disabled={!selected && !dragged} className={target === "__first" ? "is-target" : ""} onClick={() => { if (selected) move(selected, 0); }} onDragOver={event => dragOver(event, "__first")} onDrop={event => dropAt(event, 0)}><ArrowUpToLine size={14} />Move to first</button>
            <button disabled={!selected && !dragged} className={target === "__last" ? "is-target" : ""} onClick={() => { if (selected) move(selected, order.length - 1); }} onDragOver={event => dragOver(event, "__last")} onDrop={event => dropAt(event, order.length - 1)}><ArrowDownToLine size={14} />Move to last</button>
          </div>
          <p className="tos-sidebar-hint">Select a name to find its preview. Drop on the buttons above to move across the whole list.</p>
          <ol className="tos-order-list" ref={sidebarRef} aria-label="Compact template order">
            {order.map((slug, index) => <li key={slug} data-order-slug={slug} draggable
              className={`tos-order-row${selected === slug ? " is-selected" : ""}${dragged === slug ? " is-dragging" : ""}${target === slug && dragged !== slug ? " is-target" : ""}`}
              onDragStart={event => startDrag(event, slug)} onDragOver={event => dragOver(event, slug)} onDrop={event => dropAt(event, index)} onDragEnd={() => { setDragged(null); setTarget(null); }}>
              <button className="tos-list-handle" aria-label={`Reorder ${bySlug.get(slug)!.name} in list`} title="Drag, or use arrow keys; Home and End move to first and last" onKeyDown={event => handleKey(event, slug, index, true)} ref={element => { if (element) sidebarHandles.current.set(slug, element); else sidebarHandles.current.delete(slug); }}><GripVertical size={14} /></button>
              <input key={`${slug}-${index}`} className="tos-position-input" type="number" min={1} max={order.length} defaultValue={index + 1} aria-label={`Position for ${bySlug.get(slug)!.name}`}
                onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.currentTarget.value = String(index + 1); event.currentTarget.blur(); } }}
                onBlur={event => { const position = Number(event.currentTarget.value); if (Number.isInteger(position) && position >= 1 && position <= order.length) move(slug, position - 1); else event.currentTarget.value = String(index + 1); }} />
              <button className="tos-list-name" onClick={() => showCard(slug)} aria-pressed={selected === slug} title={bySlug.get(slug)!.name}>{bySlug.get(slug)!.name}</button>
              <EdgeMoveButtons name={bySlug.get(slug)!.name} position={index} count={order.length} compact onMove={position => move(slug, position)} />
            </li>)}
          </ol>
          <div className="tos-sidebar-footer">Hold a drag near a list edge to scroll.</div>
        </aside>
      <main className="tos-main">
        <div className="tos-intro">
          <div><h2>Arrange your collection.</h2><p>Drag any card to reorder. Read left to right, then top to bottom.</p></div>
          <span className="tos-save-state"><Check size={15} />{saved ? "Saved in this browser" : "Ready to export"}</span>
        </div>
        <p id="tos-keyboard-help" className="tos-keyboard-help">Use the sidebar for quick moves, or drag cards here. Arrow keys move focused drag handles; Home / End jump to first / last.</p>
        <div className="tos-grid-scroll">
          <ol className="tos-grid" aria-label="Template order">
            {order.map((slug, index) => {
              const template = bySlug.get(slug)!;
              return (
                <li key={slug} className={`tos-card${selected === slug ? " is-selected" : ""}${dragged === slug ? " is-dragging" : ""}${target === slug && dragged !== slug ? " is-target" : ""}`}
                  data-template-slug={slug} draggable
                  onDragStart={event => startDrag(event, slug)}
                  onDragOver={event => dragOver(event, slug)}
                  onDrop={event => dropAt(event, index)}
                  onDragEnd={() => { setDragged(null); setTarget(null); }}>
                  <div className="tos-card-heading"><span className="tos-position">{String(index + 1).padStart(2, "0")}</span><h3>{template.name}</h3>
                    <button className="tos-handle" aria-label={`Move ${template.name}, position ${index + 1}`} aria-describedby="tos-keyboard-help" title="Drag to reorder, or use arrow keys"
                      ref={element => { if (element) handles.current.set(slug, element); else handles.current.delete(slug); }} onKeyDown={event => handleKey(event, slug, index)}><GripVertical size={19} /></button>
                  </div>
                  <EdgeMoveButtons name={template.name} position={index} count={order.length} onMove={position => move(slug, position)} />
                  <button className="tos-paper" onClick={() => setPreview(slug)} aria-label={`Enlarge ${template.name} preview`}>
                    <img src={`/images/designs/template-order/${slug}.webp`} alt={`${template.name} CV preview`} loading={index < 6 ? "eager" : "lazy"} width={778} height={1100} draggable={false} />
                    <span className="tos-zoom"><ZoomIn size={15} />Preview</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="tos-footer">Finished arranging? Export the order and send the JSON file in our chat.</footer>
      </main>
      </div>
      <div className="tos-announcement" role="status" aria-live="polite">{message}</div>
      <dialog ref={dialogRef} className="tos-dialog" aria-labelledby="tos-preview-title" onClose={() => setPreview(null)} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}>
        {preview && <><div className="tos-dialog-heading"><h2 id="tos-preview-title">{bySlug.get(preview)!.name}</h2><button onClick={() => setPreview(null)} aria-label="Close preview"><X size={20} /></button></div><img src={`/images/designs/template-order/${preview}.webp`} alt={`${bySlug.get(preview)!.name} full-size CV preview`} /></>}
      </dialog>
    </div>
  );
}
