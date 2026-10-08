import { hasGlobalPrivacyControl, saveAnalyticsChoice } from "./app/integration/privacy";
import { installGuestExpiryCheck } from "./app/integration/guest-import";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { installAnalyticsConsentListener } from "./app/integration/analytics";

const container = document.getElementById("root")!;

const normalizePath = (path: string): string => {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path || "/";
};

const prerenderPath = container.dataset.prerenderPath;
const shouldHydrate =
  Boolean(prerenderPath) &&
  normalizePath(prerenderPath!) === normalizePath(window.location.pathname);

if (hasGlobalPrivacyControl()) {
  try { saveAnalyticsChoice(false, { notify: false, pending: true }); }
  catch { /* Unavailable storage leaves optional analytics disabled. */ }
}
installGuestExpiryCheck();
installAnalyticsConsentListener();

if (shouldHydrate) {
  hydrateRoot(container, <App />);
} else {
  container.replaceChildren();
  createRoot(container).render(<App />);
}
