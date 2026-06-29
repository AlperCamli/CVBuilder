import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { scheduleAnalytics } from "./app/integration/analytics";

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

scheduleAnalytics();

if (shouldHydrate) {
  hydrateRoot(container, <App />);
} else {
  container.replaceChildren();
  createRoot(container).render(<App />);
}
