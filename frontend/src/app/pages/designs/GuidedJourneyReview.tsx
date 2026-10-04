import GuidedJourney from "./GuidedJourney";
import { useMascotSettings } from "./useMascotSettings";

/** Browser drafts and the Studio bridge are confined to development review routes. */
export default function GuidedJourneyReview({
  pricing = false,
}: {
  pricing?: boolean;
}) {
  const settings = useMascotSettings();
  return <GuidedJourney pricing={pricing} settings={settings} />;
}
