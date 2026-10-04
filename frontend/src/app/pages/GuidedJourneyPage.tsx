import { useLocation } from "react-router";
import "./designs/designs.css";
import GuidedJourney from "./designs/GuidedJourney";

/** Public alternative; the existing / and /pricing routes remain independent. */
export default function GuidedJourneyPage() {
  const { pathname } = useLocation();
  return (
    <GuidedJourney
      key={pathname}
      pricing={pathname.replace(/\/$/, "").endsWith("/pricing")}
      basePath="/guided-journey"
      review={false}
    />
  );
}
