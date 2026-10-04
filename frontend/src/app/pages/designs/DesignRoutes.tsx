import { lazy, Suspense } from "react";
import { useLocation, useParams } from "react-router";
import { NotFound } from "../NotFound";
import { CONCEPTS, isNewConcept } from "./concepts";
import { DesignGallery } from "./DesignGallery";
import { DesignLanding } from "./DesignLandings";
import { DesignPricing } from "./DesignPricing";
import "./designs.css";

const GuidedJourney = lazy(() => import("./GuidedJourneyReview"));

const NewDesignPages = lazy(() => import("./NewDesignPages"));

export default function DesignRoutes() {
  const { concept: slug } = useParams();
  const { pathname } = useLocation();
  if (!slug) return <DesignGallery />;
  if (slug === "guided-journey")
    return (
      <Suspense fallback={null}>
        <GuidedJourney
          key={pathname}
          pricing={pathname.replace(/\/$/, "").endsWith("/pricing")}
        />
      </Suspense>
    );
  const concept = CONCEPTS.find((item) => item.id === slug);
  if (!concept) return <NotFound />;
  if (isNewConcept(concept.id))
    return (
      <Suspense fallback={null}>
        <NewDesignPages
          key={pathname}
          concept={concept.id}
          pricing={pathname.replace(/\/$/, "").endsWith("/pricing")}
        />
      </Suspense>
    );
  return pathname.replace(/\/$/, "").endsWith("/pricing") ? (
    <DesignPricing key={pathname} concept={concept.id} />
  ) : (
    <DesignLanding key={pathname} concept={concept.id} />
  );
}
