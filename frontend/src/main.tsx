import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { AuthProvider } from "./app/integration/auth-context";

const container = document.getElementById("root")!;
const tree = (
  <AuthProvider>
    <App />
  </AuthProvider>
);

if (container.hasChildNodes()) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
