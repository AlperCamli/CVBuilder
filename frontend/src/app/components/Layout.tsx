import { Outlet, Link, useLocation } from "react-router";
import {
  FileText,
  Briefcase,
  FileCheck,
  CreditCard,
  User,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Mail,
  LogOut
} from "lucide-react";
import { useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";

export function Layout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { sidebarVisible, toggleSidebar } = useSidebar();
  const { me, signOut, authMessage, clearAuthMessage } = useAuth();

  const navItems = [
    { path: "/app", label: "Dashboard", icon: FileText },
    { path: "/app/resumes", label: "My CVs", icon: FileCheck },
    { path: "/app/job-tracker", label: "Applications", icon: Briefcase },
    { path: "/app/cover-letters", label: "Cover Letters", icon: Mail },
    { path: "/app/pricing", label: "Pricing", icon: CreditCard },
    { path: "/app/profile", label: "Profile", icon: User }
  ];

  const isActive = (path: string) => {
    if (path === "/app") {
      return location.pathname === "/app";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-white">
      {!mobileMenuOpen && (
        <button
          className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg"
          style={{ background: "var(--color-teal-600)", color: "white" }}
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu size={20} />
        </button>
      )}

      <aside
        className={`${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"} ${
          sidebarVisible ? "lg:translate-x-0" : "lg:-translate-x-full"
        } fixed lg:relative w-[220px] h-screen border-r flex flex-col transition-transform duration-300 bg-white z-40`}
        style={{
          borderColor: "var(--color-border-tertiary)"
        }}
      >
        <div style={{ width: "220px", height: "100%", display: "flex", flexDirection: "column" }}>
          <Link to="/" className="flex items-center gap-2 p-6">
            <div className="w-6 h-6 rounded-md" style={{ background: "var(--color-teal-600)" }} />
            <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
              Resumé
            </span>
          </Link>

          <nav className="flex-1 px-3">
            <div className="flex flex-col gap-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors"
                    style={{
                      background: active ? "var(--color-teal-50)" : "transparent",
                      color: active ? "var(--color-teal-800)" : "var(--color-text-secondary)"
                    }}
                  >
                    <Icon size={14} />
                    <span className="font-medium" style={{ fontSize: "13px" }}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="p-3 border-t" style={{ borderColor: "var(--color-border-tertiary)" }}>
            <div className="mb-2 px-2.5 py-1.5" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              {me?.user.full_name || me?.user.email || "Authenticated user"}
            </div>
            <button
              onClick={() => {
                void signOut();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <LogOut size={14} />
              <span className="font-medium" style={{ fontSize: "13px" }}>
                Sign out
              </span>
            </button>
          </div>
        </div>
      </aside>

      <div
        className="hidden lg:block transition-all duration-300"
        style={{
          width: sidebarVisible ? "0px" : "0px",
          marginLeft: sidebarVisible ? "0px" : "-220px"
        }}
      />

      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-30"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {!mobileMenuOpen && (
        <button
          onClick={toggleSidebar}
          className="hidden lg:block fixed top-4 z-50 p-2 rounded-lg transition-all hover:bg-gray-100"
          style={{
            left: sidebarVisible ? "200px" : "16px",
            color: "var(--color-text-secondary)"
          }}
          title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      )}

      <main className="flex-1 overflow-auto transition-all duration-300">
        {authMessage && (
          <div
            className="m-4 px-4 py-3 rounded-lg border flex items-center justify-between"
            style={{
              borderColor: "var(--color-red-200)",
              background: "var(--color-red-50)",
              color: "var(--color-red-700)",
              fontSize: "13px"
            }}
          >
            <span>{authMessage}</span>
            <button
              type="button"
              onClick={clearAuthMessage}
              className="ml-4 underline"
              style={{ color: "var(--color-red-700)" }}
            >
              Dismiss
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
