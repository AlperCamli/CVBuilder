import { useCallback, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Caption on the left, Chart/Table toggle on the right; the table is the accessible, exact view of every shape. */
export function ChartFrame({ caption, table, children }: { caption?: ReactNode; table: ReactNode; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-subtle">{caption}</div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Chart" : "Table"}
        </Button>
      </div>
      {showTable ? table : children}
    </div>
  );
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

const TIP_HALF_WIDTH = 96;

/**
 * Per-mark hover/focus tooltip for the HTML charts. Spread `bind(content)` on a mark and render `node` inside the
 * element that carries `ref` (it must be `relative`). Tooltips enhance; every value is also in the table view.
 */
export function useHoverTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const show = useCallback((el: Element, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const r = el.getBoundingClientRect();
    const center = r.left - box.left + r.width / 2;
    const x = box.width > TIP_HALF_WIDTH * 2 ? Math.min(Math.max(center, TIP_HALF_WIDTH), box.width - TIP_HALF_WIDTH) : box.width / 2;
    setTip({ x, y: r.top - box.top, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const bind = (content: ReactNode) => ({
    onMouseEnter: (e: MouseEvent) => show(e.currentTarget, content),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent) => show(e.currentTarget, content),
    onBlur: hide,
  });

  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-40 max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border bg-card px-3 py-2 text-xs shadow-md"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.content}
    </div>
  );
  return { ref, bind, node };
}

/** Tooltip body: a heading line and label/value rows (values in primary ink, labels muted). */
export function TipBody({ title, rows }: { title: ReactNode; rows: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <>
      <div className="mb-1.5 font-medium">{title}</div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
