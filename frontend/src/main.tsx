import { hasGlobalPrivacyControl, saveAnalyticsChoice } from "./app/integration/privacy";
import { installGuestExpiryCheck } from "./app/integration/guest-import";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { installAnalyticsConsentListener } from "./app/integration/analytics";
import { DESIGN_TOOLS_ENABLED } from "./app/design-tools";

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


async function mount() {
  let previewFrame = false;
  if (DESIGN_TOOLS_ENABLED && new URLSearchParams(window.location.search).get("languagePreview") === "1" && window.parent !== window) {
    const { installLanguagePreview } = await import("./app/localization/studio/language-preview");
    installLanguagePreview();
    const { installStudioDemo } = await import("./app/localization/studio/demo-provider");
    installStudioDemo();
    previewFrame = true;
  }
  if (!previewFrame) {
    if (hasGlobalPrivacyControl()) {
      try { saveAnalyticsChoice(false, { notify: false, pending: true }); }
      catch { /* Unavailable storage leaves optional analytics disabled. */ }
    }
    installGuestExpiryCheck();
    installAnalyticsConsentListener();
  }
  // Finish loading the public boundary before preference effects can update it.
  // The first browser render still uses the URL language of the prerendered HTML.
  const guidedJourney = /^(\/|\/pricing|\/tr|\/tr\/pricing|\/guided-journey(?:\/pricing)?)\/?$/.test(window.location.pathname)
    ? (await import("./app/pages/GuidedJourneyPage")).default : undefined;
  const app = <App guidedJourney={guidedJourney} />;
  if (shouldHydrate && !previewFrame) hydrateRoot(container, app);
  else { container.replaceChildren(); createRoot(container).render(app); }
}
void mount();
