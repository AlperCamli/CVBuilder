import type { ReactNode } from "react";

/** A quiet inline marker for caveats; the title carries the explanation. */
export function Badge({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded border px-1 text-[10px] font-normal leading-4 text-subtle" title={title}>
      {children}
    </span>
  );
}

export const SmallSampleBadge = ({ minGroup }: { minGroup: number }) => (
  <Badge title={`Fewer than ${minGroup} in this range; read the number with care.`}>small sample</Badge>
);
