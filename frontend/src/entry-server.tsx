import { i18n } from "./app/localization/i18n";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { RouteContents } from "./app/routes";

export async function renderRoute(path: string): Promise<string> {
  // Load the primary public journey before synchronous static rendering. The same
  // Suspense boundary remains in the route tree for matching client hydration.
  await i18n.changeLanguage(/^\/tr(?:\/|$)/.test(path) ? "tr" : "en");
  const guidedJourney = /^(?:\/|\/pricing|\/tr|\/tr\/pricing|\/guided-journey(?:\/pricing)?)(?:[?#]|$)/.test(path)
    ? (await import("./app/pages/GuidedJourneyPage")).default
    : undefined;
  return renderToString(
    <StaticRouter location={path}>
      <RouteContents guidedJourney={guidedJourney} />
    </StaticRouter>,
  );
}
