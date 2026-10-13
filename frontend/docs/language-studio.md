# Edit interface languages in Language Studio

From the repository root, run `npm --prefix frontend run dev` and open:

`http://localhost:5173/designs/guided-journey/languages`

Language Studio is also linked from Companion Studio and the design gallery. It is available locally and in dedicated review builds with `VITE_ENABLE_DESIGN_TOOLS=true`. Normal production builds exclude both the editor and its preview bridge. The review route is marked `noindex`.

## Edit and review

- Select **Türkçe** or **English**. The catalog contains all interface text entries, including dialogs, accessibility labels, errors, mascot dialogue, FAQ copy and parameterized review messages.
- The list starts with texts on the preview page. Use **All texts**, search, or the area filter to find anything else. Missing translations fall back to the original English text.
- Select a text in the list or click it in the preview. Edit **Your text** and watch the preview update. **Find on page** scrolls to a rendered occurrence when present.
- Choose landing, pricing, the first-visit language chooser, authentication, onboarding, privacy, or any app page. Every preview uses isolated demo data, so no account, administrator access, backend, Supabase or Stripe connection is required. App previews render the real product components with a fictional account, English/Turkish CVs, applications and cover letters.
- Use **Interact with page** to open menus, dialogs, templates and linked demo documents. Editing, saving a CV/profile/letter, deleting a sample CV or changing an application status affects only the iframe's memory. Payments, uploads, exports, external links and unsupported server actions are disabled. The ordinary app outside the preview still requires authentication.
- Use **State** to inspect populated, empty, loading and error screens, **Account** to preview Free/paid plans, and **Prices** for TRY/USD sample pricing. Demo amounts illustrate layout; they are not live Stripe prices. Those selectors and **Reset demo** reload the sample scene. Changing language or translation text preserves the current scene, form values and demo edits.
- Try desktop, tablet and phone viewport widths. The browser window itself can also be resized.
- **Reviewed by me** records your progress. Editing a reviewed entry clears that mark. **Undo/Redo** restores earlier edits, imports and language changes.
- Preserve `{{placeholders}}` exactly. They contain values such as plan names, scores and prices. The editor warns about missing/unknown variables and blocks catalog export until those warnings are fixed. Workspace export remains available for unfinished drafts.

Changes and review marks are saved in this browser's local storage. The preview itself uses temporary isolated storage and never reads your signed-in session or writes your account data, remembered preferences, pending checkout or real CV drafts. CV document language is independent of interface language: select the English or Turkish CV/letter editor in the page menu. Export workspace periodically to back up your work outside the browser.

## Export and import

**Export catalog** downloads `<language-code>.json`, a flat catalog ready for `react-i18next`. For Turkish, replace `frontend/src/app/localization/tr.json` with the downloaded `tr.json`, review the Git diff, and run frontend tests/build before publishing. Keep English source keys unchanged. Empty entries are omitted so the fallback can work.

**Export workspace** downloads `language-workspace.json` containing every language, display names, text directions, review marks and unfinished work. **Import JSON** accepts that workspace, a version-1 language configuration, or an existing flat catalog. A flat catalog replaces the selected language's translations. Undo restores the earlier draft. Invalid imports leave the draft intact.

## Prepare another language

Click **+**, enter a language code such as `de`, `fr`, `ar` or `pt-BR`, its display name, and left-to-right/right-to-left direction. A new language begins with empty translations and English preview fallback. It can be edited, previewed and exported immediately without registering it in the live app.

Enabling that language for real users is a separate release change: add its catalog and metadata to the central registry in `i18n.ts`, expand account/auth locale validation and email localization, add localized public routes/SEO/prerendering, and audit code using explicit English/Turkish branches. CV translation languages can be enabled separately through the CV settings and protected catalog import below. New scripts still require font/shaping/export checks. Interface activation and regional pricing remain separate.

## Configure CV document languages

Choose **CV languages & headings** to enable the selected language for CV translation and edit its standard CV section headings. These settings are independent of interface text. English and Turkish begin enabled; new languages begin disabled. Every heading must be filled before an enabled language can be exported. For example, change Turkish Work Experience to `Deneyimler` here without changing its interface label.

**Export CV languages** produces `cv-languages.json`. Apply the CV catalog migration and publish this file using the backend's protected `languages:import` command; browser-local changes do not publish themselves. **Export workspace** includes CV settings and preserves undo/import behavior. See [CV translation](../../backend/docs/cv-translation.md) for the administrator import procedure and validation.

This tool edits interface catalogs and CV language configuration. User-authored CV content, AI-generated narrative, career-advice articles, Stripe amounts and backend authentication-email templates retain their own sources.

## Verification

With the development server running, execute `node frontend/scripts/verify-language-studio.mjs` from the repository root. The browser check uses isolated billing/privacy/auth fixtures and verifies live edits, reload persistence, Unicode JSON export, a new language, safe import failures, remembered-language isolation, form preservation and mobile layout. It prints a temporary artifact directory with screenshots and exported catalogs.

Run `node frontend/scripts/verify-language-demo.mjs` to check every app demo scene, empty/loading/error states, plan and currency controls, local profile saving, language changes without losing form edits, navigation, storage/network isolation and the normal app's sign-in requirement.
