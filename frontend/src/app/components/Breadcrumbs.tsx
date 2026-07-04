import { Link } from "react-router";
import { ChevronRight } from "lucide-react";

export type BreadcrumbItem = {
  name: string;
  // Omit path on the last item (the current page).
  path?: string;
};

// Visible breadcrumb trail matching the BreadcrumbList JSON-LD emitted for the
// route (src/content/seo-meta.mjs) — Google expects marked-up breadcrumbs to
// be represented on the page.
export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol
        className="flex flex-wrap items-center gap-y-1"
        style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.name}-${index}`} className="flex items-center">
              {index > 0 && (
                <ChevronRight size={13} aria-hidden="true" className="mx-1.5 shrink-0" />
              )}
              {item.path && !isLast ? (
                <Link to={item.path} style={{ color: "var(--color-teal-700)" }}>
                  {item.name}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>{item.name}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
