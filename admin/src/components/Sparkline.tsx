/** Tiny trend line: de-emphasised history with the latest point in the accent. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pad = 4;
  const points = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const [lx, ly] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="var(--subtle)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r={3} fill="var(--series-1)" stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}
