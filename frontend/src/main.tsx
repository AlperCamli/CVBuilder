import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { AuthProvider } from "./app/integration/auth-context";

// The prerendered HTML inside #root is for crawlers only. We always
// createRoot (not hydrateRoot) so React owns the DOM cleanly without
// hydration mismatches from runtime-added attributes (data-discover,
// muted, portals, etc.).
const container = document.getElementById("root")!;
container.innerHTML = "";

createRoot(container).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
