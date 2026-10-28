import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { createQueryClient } from "@/lib/api";
import { MetricsPage } from "@/pages/MetricsPage";
import { OverviewPage } from "@/pages/Overview";
import { PlaceholderPage } from "@/pages/Placeholder";
import { UserProfilePage } from "@/pages/UserProfile";
import { UsersPage } from "@/pages/Users";
import { AuthGate } from "./AuthGate";
import { Layout } from "./Layout";
import { NAV } from "./nav";

export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthGate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<OverviewPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:id" element={<UserProfilePage />} />
              {NAV.filter((n) => n.sections).map((n) => (
                <Route key={n.path} path={n.path} element={<MetricsPage key={n.path} sections={n.sections!} />} />
              ))}
              {NAV.filter((n) => !n.ready).map((n) => (
                <Route key={n.path} path={n.path} element={<PlaceholderPage title={n.label} />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
