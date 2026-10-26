import type { CSSProperties, ReactNode } from "react";
import { Loader2, Sparkles } from "lucide-react";

// Small AI-state primitives in the style of shadcn AI Elements (shimmer, working badge),
// built on the app's existing tokens so they need no extra dependency.

export function Shimmer({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`ai-shimmer-text ${className}`} style={style}>
      {children}
    </span>
  );
}

export function AiWorkingBadge({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full ai-working-marker"
      style={{
        padding: compact ? "2px 8px" : "4px 10px",
        fontSize: compact ? "10px" : "11px",
        fontWeight: 500,
        background: "var(--color-teal-50)",
        color: "var(--color-teal-800)",
        border: "1px solid var(--color-teal-200)",
        whiteSpace: "nowrap"
      }}
    >
      <Loader2 size={compact ? 10 : 12} className="animate-spin" />
      {label}
    </span>
  );
}

export function AiStatusLine({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2" style={{ fontSize: "13px" }}>
      <Sparkles size={14} style={{ color: "var(--color-teal-600)", marginTop: 2, flexShrink: 0 }} />
      <div className="min-w-0">
        <Shimmer style={{ fontWeight: 500 }}>{label}</Shimmer>
        {detail ? (
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: 2 }}>{detail}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ShimmerBlock({ height = 56 }: { height?: number }) {
  return <div className="ai-shimmer-block" style={{ height }} aria-hidden="true" />;
}
