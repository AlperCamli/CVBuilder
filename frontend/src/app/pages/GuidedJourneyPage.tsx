import { useLocation } from "react-router";
import "./designs/designs.css";
import GuidedJourney from "./designs/GuidedJourney";

/** Public alternative; the existing / and /pricing routes remain independent. */
export default function GuidedJourneyPage() {
  const { pathname, search } = useLocation();
  return (
    <>
    {new URLSearchParams(search).get("deletion") === "requested" && <p role="status" className="p-4 text-center bg-teal-50 text-teal-800">Your account deletion has been requested. Account access is blocked, and any failed removal steps will be retried.</p>}
    <GuidedJourney
      key={pathname}
      pricing={pathname.replace(/\/$/, "").endsWith("/pricing")}
      basePath="/guided-journey"
      review={false}
    />
    </>
  );
}
