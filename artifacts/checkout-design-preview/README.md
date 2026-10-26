# Checkout design preview

Open `index.html` in a browser. Use the top tabs to switch between cancellation and automatic redirect. Resize the window to review mobile. Images are embedded, so the HTML works offline.

This is a standalone visual proposal. It does not modify application routes, React components, checkout behavior, billing configuration, or deployments. Payment buttons are intentionally inactive in this preview.

The design adapts the existing limit/upgrade card's mint header, rounded white body, benefit checklist, and teal primary action. It uses the existing guide mascot and app colors. The mascot is mirrored horizontally to face left toward the card copy.

## Cancellation

The trial is the main action for eligible accounts. A secondary action retries the originally selected paid plan. Card requirements, weekly renewal after the trial, cancellation, a route back to plans, and support remain visible. The real implementation must use verified trial eligibility and preserve the original next step. Accounts without trial eligibility need paid retry copy instead of a trial offer.

## Automatic redirect

Show the actual selected plan and billing period, a short checkout progress indicator, a loading state, and a manual continuation fallback. The shown journey is for a direct purchase before onboarding. Other entry points should use their actual next step, not always say “Build your CV.” The implementation should prevent duplicate checkout requests and offer retry/support if opening Stripe fails.

## Prices and states

The mockups illustrate the Turkey market with TRY 149.90 weekly and TRY 349.90 monthly. Production must use the validated live regional catalog and existing formatting. The preview does not initiate checkout, verify payment, or imply a completed payment. Loading, unavailable pricing, failed checkout, trial ineligibility, and successful activation must retain their existing backend checks.

Checked in Chromium at desktop 1440px and mobile 390px/320px widths, including view switching, loaded images, JavaScript errors, and horizontal overflow.
