import { useIsFetching } from "@tanstack/react-query";
import { AlertTriangle, Info, LogOut, Menu, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { AlertBadge } from "@/components/AlertBadge";
import { Button } from "@/components/ui/button";
import { useCatalog, useRefreshPage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthGate";
import { FilterBar } from "./FilterBar";
import { NAV, useCurrentPage } from "./nav";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  // Page filters travel with nav links. The user-search term never appears in any URL (it lives in history.state).
  const { search } = useLocation();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.map(({ path, label, icon: Icon }) => (
        <li key={path}>
          <NavLink
            to={{ pathname: path, search }}
            end={path === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                isActive && "bg-accent font-medium text-foreground",
              )
            }
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function Layout() {
  const { email, signOut } = useAuth();
  const refresh = useRefreshPage();
  const fetching = useIsFetching() > 0;
  const catalog = useCatalog();
  const [menuOpen, setMenuOpen] = useState(false);
  const page = useCurrentPage();
  const current = page?.label ?? "Admin";

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm shadow focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col gap-4 border-r bg-card p-3 md:flex">
        <div className="px-2.5 pt-1 text-sm font-semibold">CV Builder Admin</div>
        <nav aria-label="Main">
          <NavLinks />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-col gap-2 border-b bg-card/95 px-4 py-2.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{current}</h1>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={fetching}>
              <RefreshCw className={cn(fetching && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <AlertBadge />
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline" title={email}>
              {email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()} aria-label="Sign out" title={`Sign out ${email}`}>
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
          {menuOpen && (
            <nav aria-label="Main" className="border-t pt-2 md:hidden">
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </nav>
          )}
          {page?.people ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              Every lookup is logged. Page filters don't apply here; all dates UTC.
            </p>
          ) : page?.note ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              {page.note}
            </p>
          ) : (
            <FilterBar />
          )}
        </header>
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-col gap-4 p-4 outline-none md:p-6">
          {catalog.isError && !page?.people && !page?.note && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                The metric catalog could not be loaded, so titles, definitions and breakdown options may be missing. Use
                Refresh to try again.
              </span>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
