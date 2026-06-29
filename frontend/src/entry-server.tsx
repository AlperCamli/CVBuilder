import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { RouteElements } from "./app/routes";

export function renderRoute(path: string) {
  return renderToString(
    <StaticRouter location={path}>
      <RouteElements />
    </StaticRouter>
  );
}
