import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { RouteElements } from "./app/routes";

export async function renderRoute(path: string): Promise<string> {
  // Load the public alternative before synchronous static rendering. The same
  // Suspense boundary remains in the route tree for matching client hydration.
  const guidedJourney = /^\/guided-journey(?:\/pricing)?(?:[?#]|$)/.test(path)
    ? (await import("./app/pages/GuidedJourneyPage")).default
    : undefined;
  return renderToString(
    <StaticRouter location={path}>
      <RouteElements guidedJourney={guidedJourney} />
    </StaticRouter>,
  );
}
