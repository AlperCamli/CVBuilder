import { AppRoutes } from "./routes";
import type { ComponentType } from "react";

export default function App({ guidedJourney }: { guidedJourney?: ComponentType } = {}) {
  return <AppRoutes guidedJourney={guidedJourney} />;
}
