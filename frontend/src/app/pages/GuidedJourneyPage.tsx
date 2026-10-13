import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useLocation } from "react-router";
import "./designs/designs.css";
import GuidedJourney from "./designs/GuidedJourney";

/** Primary public landing/pricing, rendered in the language of its URL. */
export default function GuidedJourneyPage() {
  useTranslation();
  const { pathname, search } = useLocation();
  useEffect(() => {
    const root = document.getElementById("root");
    if (root) root.dataset.publicHydrated = pathname;
    window.dispatchEvent(new CustomEvent("cv-public-hydrated", { detail: pathname }));
    return () => { if (root?.dataset.publicHydrated === pathname) delete root.dataset.publicHydrated; };
  }, [pathname]);
  return (
    <>
    {new URLSearchParams(search).get("deletion") === "requested" && <p role="status" className="p-4 text-center bg-teal-50 text-teal-800">{t("Your account deletion has been requested. Account access is blocked, and any failed removal steps will be retried.")}</p>}
    <GuidedJourney
      pricing={pathname.replace(/\/$/, "").endsWith("/pricing")}
      basePath={pathname.startsWith("/tr") ? "/tr" : ""}
      review={false}
    />
    </>
  );
}
