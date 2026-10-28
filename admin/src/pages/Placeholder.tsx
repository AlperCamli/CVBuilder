import { Construction } from "lucide-react";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-10 text-center">
      <Construction className="size-6 text-subtle" aria-hidden="true" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">Coming in a later phase.</p>
    </div>
  );
}
