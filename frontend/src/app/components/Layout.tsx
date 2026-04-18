import { Outlet, Link, useLocation } from "react-router";
import { FileText, Briefcase, FileCheck, CreditCard, User, Menu, PanelLeftClose, PanelLeft, Mail } from "lucide-react";
import { useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";

export function Layout() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { sidebarVisible, toggleSidebar } = useSidebar();

  const navItems = [
    { path: "/app", label: "Dashboard", icon: FileText },
    { path: "/app/resumes", label: "My CVs", icon: FileCheck },
    { path: "/app/job-tracker", label: "Applications", icon: Briefcase },
    { path: "/app/cover-letters", label: "Cover Letters", icon: Mail },
    { path: "/app/pricing", label: "Pricing", icon: CreditCard },
    { path: "/app/profile", label: "Profile", icon: User },
  ];

  const isActive = (path: string) => {
    if (path === "/app") {
      return location.pathname === "/app";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Mobile Menu Button - only show when menu is closed */}
      {!mobileMenuOpen && (
        <button
          className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg"
          style={{ background: "var(--color-teal-600)", color: "white" }}
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu size={20} />
        </button>
      )}

      {/* Sidebar */}
      <aside
        className={`${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          sidebarVisible ? "lg:translate-x-0" : "lg:-translate-x-full"
        } fixed lg:relative w-[220px] h-screen border-r flex flex-col transition-transform duration-300 bg-white z-40`}
        style={{ 
          borderColor: "var(--color-border-tertiary)",
        }}
      >
        {/* Fixed width content wrapper to prevent squishing */}
        <div style={{ width: "220px", height: "100%", display: "flex", flexDirection: "column" }}>
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 p-6">
            <div
              className="w-6 h-6 rounded-md"
              style={{ background: "var(--color-teal-600)" }}
            />
            <span className="font-medium" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
              Resumé
            </span>
          </Link>

          {/* Navigation */}
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
                      color: active ? "var(--color-teal-800)" : "var(--color-text-secondary)",
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
        </div>
      </aside>

      {/* Spacer to account for hidden sidebar on desktop */}
      <div 
        className="hidden lg:block transition-all duration-300"
        style={{ 
          width: sidebarVisible ? "0px" : "0px",
          marginLeft: sidebarVisible ? "0px" : "-220px",
        }}
      />

      {/* Overlay for mobile */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-30"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Toggle Sidebar Button (Desktop only) */}
      {!mobileMenuOpen && (
        <button
          onClick={toggleSidebar}
          className="hidden lg:block fixed top-4 z-50 p-2 rounded-lg transition-all hover:bg-gray-100"
          style={{
            left: sidebarVisible ? "200px" : "16px",
            color: "var(--color-text-secondary)",
          }}
          title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto transition-all duration-300">
        <Outlet />
      </main>
    </div>
  );
}