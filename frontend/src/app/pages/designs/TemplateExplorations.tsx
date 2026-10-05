import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowDown } from "lucide-react";
import { NotFound } from "../NotFound";
import "./designs.css";
import GuidedJourney from "./GuidedJourney";
import { useMascotSettings } from "./useMascotSettings";
import { TemplateShowcase } from "./TemplateShowcase";
import { SHOWCASE_DIRECTIONS, showcasePath } from "./template-showcase-data";

export default function TemplateExplorations() {
  const { presentation } = useParams();
  const direction = SHOWCASE_DIRECTIONS.find(
    (item) => item.id === presentation,
  );
  const settings = useMascotSettings();
  const [overlay, setOverlay] = useState(false);
  if (!direction) return <NotFound />;
  return (
    <div className="ts-review-page">
      <nav
        className="ts-review-nav"
        aria-label="Compare template presentations"
      >
        <Link to="/designs">
          <ArrowLeft size={14} />
          <span>Designs</span>
        </Link>
        <div>
          <span className="ts-review-label">TEMPLATE SECTION</span>
          {SHOWCASE_DIRECTIONS.map((item, index) => (
            <Link
              key={item.id}
              to={`${showcasePath(item.id)}#templates`}
              aria-current={direction.id === item.id ? "page" : undefined}
            >
              {index + 1}. {item.name}
            </Link>
          ))}
        </div>
        <a href="#templates">
          See section <ArrowDown size={14} />
        </a>
      </nav>
      <GuidedJourney
        review={false}
        settings={settings}
        templateOverlayOpen={overlay}
        templateSection={
          <TemplateShowcase
            key={direction.id}
            direction={direction.id}
            onOverlayChange={setOverlay}
          />
        }
      />
    </div>
  );
}
