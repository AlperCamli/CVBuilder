import { Link } from "react-router";
import { CAREER_CATEGORIES, getCareerCategoryPath } from "../../content/career-advice";
import { useAuth } from "../integration/auth-context";

type PublicHeaderProps = {
  activeCategorySlug?: string;
};

export function PublicHeader({ activeCategorySlug }: PublicHeaderProps) {
  const { isAuthenticated } = useAuth();

  return (
    <header
      className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur"
      style={{ borderColor: "var(--color-border-tertiary)" }}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src="/images/logo.png" alt="" className="w-7 h-7 rounded-lg object-contain shrink-0" />
          <span className="font-medium" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
            jobspecificCV
          </span>
        </Link>

        <nav
          className="hidden lg:flex items-center gap-5 min-w-0"
          aria-label="Public navigation"
        >
          <Link
            to="/#how-it-works"
            style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
          >
            How it works
          </Link>
          <Link
            to="/career-advice"
            style={{ fontSize: "13px", color: activeCategorySlug ? "var(--color-text-secondary)" : "var(--color-teal-700)" }}
          >
            Guides
          </Link>
          {CAREER_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              to={getCareerCategoryPath(category)}
              style={{
                fontSize: "13px",
                color:
                  activeCategorySlug === category.slug
                    ? "var(--color-teal-700)"
                    : "var(--color-text-secondary)",
              }}
            >
              {category.navLabel}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {isAuthenticated ? (
            <Link
              to="/app"
              className="interactive-button px-4 py-2 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                background: "#E1F5EF",
                color: "var(--color-teal-600)",
              }}
            >
              Dashboard
            </Link>
          ) : (
            <Link
              to="/signin"
              className="interactive-button px-4 py-2 rounded-lg font-medium transition-colors"
              style={{ fontSize: "13px", color: "var(--color-teal-600)" }}
            >
              Sign in
            </Link>
          )}
          <Link
            to="/app/create"
            className="interactive-button px-4 py-2 rounded-lg font-medium transition-colors"
            style={{
              fontSize: "13px",
              background: "var(--color-teal-600)",
              color: "var(--color-teal-50)",
            }}
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
