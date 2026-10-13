import {
  CV_SECTION_TITLES,
  defaultCvLanguageDraft,
  type CvLanguageDraft,
} from "../../localization/studio/cv-language-catalog";
import type { LanguageConfiguration } from "../../localization/studio/language-catalog";

export function CvLanguageSettings({ configuration, onChange }: {
  configuration: LanguageConfiguration;
  onChange: (draft: CvLanguageDraft, key: string) => void;
}) {
  const draft = configuration.cvDocument ?? defaultCvLanguageDraft(configuration.code);
  return (
    <section className="ls-editor" aria-label="CV language settings">
      <div className="ls-editor-heading">
        <div>
          <span className="ls-eyebrow">CV DOCUMENT LANGUAGE</span>
          <h2>{configuration.name} CV headings</h2>
        </div>
      </div>
      <p>
        Choose which languages users can translate their CVs into. These headings
        replace section titles without AI. Interface translations are managed separately.
      </p>
      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={event => onChange({ ...draft, enabled: event.target.checked }, `cv-enabled:${configuration.code}`)}
        />{" "}
        Enable as a CV translation language
      </label>
      <div className="ls-cv-headings">
        {Object.entries(CV_SECTION_TITLES).map(([type, title]) => (
          <label key={type} htmlFor={`cv-heading-${type}`}>
            {title}
            <input
              id={`cv-heading-${type}`}
              lang={configuration.code}
              dir={configuration.direction}
              maxLength={160}
              value={draft.sectionTitles[type] ?? ""}
              placeholder={title}
              onChange={event => onChange({
                ...draft,
                sectionTitles: { ...draft.sectionTitles, [type]: event.target.value },
              }, `cv-heading:${configuration.code}:${type}`)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
