import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Menu, X } from "lucide-react";
import { CAREER_CATEGORIES, getCareerCategoryPath } from "../../content/career-advice";
import { useAuth } from "../integration/auth-context";

type PublicHeaderProps = {
  activeCategorySlug?: string;
};

export function PublicHeader({ activeCategorySlug }: PublicHeaderProps) {
  const { isAuthenticated } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const mobileDrawer =
    isMobileMenuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            id="public-mobile-navigation"
            className="sm:hidden fixed inset-0 z-[100] bg-slate-900/70"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0"
              onClick={closeMobileMenu}
            />
            <nav
              className="absolute right-0 top-0 h-full w-[min(320px,calc(100vw-48px))] bg-white px-5 py-5 shadow-2xl"
              aria-label="Mobile public navigation"
            >
              <div className="flex items-center justify-between gap-4 mb-6">
                <Link to="/" onClick={closeMobileMenu} className="flex items-center gap-2 min-w-0">
                  <img src="/images/logo.png" alt="" className="w-7 h-7 rounded-lg object-contain shrink-0" />
                  <span
                    className="font-medium truncate"
                    style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
                  >
                    jobspecificCV
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  className="w-10 h-10 rounded-lg border inline-flex items-center justify-center shrink-0"
                  onClick={closeMobileMenu}
                  style={{
                    borderColor: "var(--color-border-tertiary)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <Link
                  to="/#how-it-works"
                  onClick={closeMobileMenu}
                  className="rounded-lg px-3 py-3 text-left"
                  style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
                >
                  How it works
                </Link>
                <Link
                  to="/career-advice"
                  onClick={closeMobileMenu}
                  className="rounded-lg px-3 py-3 text-left"
                  style={{
                    fontSize: "15px",
                    color: activeCategorySlug ? "var(--color-text-primary)" : "var(--color-teal-700)",
                    background: activeCategorySlug ? "transparent" : "var(--color-teal-50)",
                  }}
                >
                  Guides
                </Link>
                {CAREER_CATEGORIES.map((category) => {
                  const active = activeCategorySlug === category.slug;
                  return (
                    <Link
                      key={category.slug}
                      to={getCareerCategoryPath(category)}
                      onClick={closeMobileMenu}
                      className="rounded-lg px-3 py-3 text-left"
                      style={{
                        fontSize: "15px",
                        color: active ? "var(--color-teal-700)" : "var(--color-text-primary)",
                        background: active ? "var(--color-teal-50)" : "transparent",
                      }}
                    >
                      {category.navLabel}
                    </Link>
                  );
                })}
              </div>

              <div
                className="mt-5 pt-5 border-t grid grid-cols-1 gap-3"
                style={{ borderColor: "var(--color-border-tertiary)" }}
              >
                {isAuthenticated ? (
                  <Link
                    to="/app"
                    onClick={closeMobileMenu}
                    className="interactive-button px-4 py-3 rounded-lg font-medium text-center transition-colors"
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
                    onClick={closeMobileMenu}
                    className="interactive-button px-4 py-3 rounded-lg font-medium text-center transition-colors"
                    style={{
                      fontSize: "13px",
                      color: "var(--color-teal-600)",
                      border: "1px solid var(--color-border-tertiary)",
                    }}
                  >
                    Sign in
                  </Link>
                )}
                <Link
                  to="/app/create"
                  onClick={closeMobileMenu}
                  className="interactive-button px-4 py-3 rounded-lg font-medium text-center transition-colors"
                  style={{
                    fontSize: "13px",
                    background: "var(--color-teal-600)",
                    color: "var(--color-teal-50)",
                  }}
                >
                  Get started
                </Link>
              </div>
            </nav>
          </div>,
          document.body
        )
      : null;

  return (
    <>
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

        <div className="hidden sm:flex items-center gap-3 shrink-0">
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

        <button
          type="button"
          className="sm:hidden w-10 h-10 rounded-lg border inline-flex items-center justify-center"
          aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isMobileMenuOpen}
          aria-controls="public-mobile-navigation"
          onClick={() => setIsMobileMenuOpen((open) => !open)}
          style={{
            borderColor: "var(--color-border-tertiary)",
            color: "var(--color-text-primary)",
          }}
        >
          {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        </div>
      </header>
      {mobileDrawer}
    </>
  );
}
