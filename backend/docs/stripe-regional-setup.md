# Configure existing Stripe products for USD and TRY

Keep your three existing weekly, monthly and annual products and USD prices. Add a separate TRY price under each corresponding product. You do not need to recreate products, move existing subscribers, or replace current USD IDs. The backend now validates a separate product ID for each plan; `STRIPE_PRODUCT_ID` remains an optional fallback for a catalog using one shared product.

## 1. Collect product IDs and create TRY prices

Start in Stripe test mode or a sandbox. Use test objects with your test key; use live objects with your live key when configuring Production. The IDs differ between environments. Retain your existing live products and prices.

In **Stripe Dashboard → Product catalog**, open each product. Copy its `prod_...` ID, then select its existing USD price and copy its `price_...` ID. On that product, choose **Add another price**:

- Use flat-rate **Recurring** pricing.
- Set the new price's currency to **TRY** and enter your chosen amount.
- Use exactly one **week**, **month**, or **year**, matching the plan.
- Keep the price active and copy its new `price_...` ID.

Create a separate TRY Price ID. Adding a TRY currency option to the existing USD price is a different Stripe feature and is not the catalog this implementation validates. A weekly interval must be `week` with count `1`; `day` with count `7` is not accepted.

| Existing product | Product environment variable | Existing USD price variable | New TRY price variable |
| --- | --- | --- | --- |
| Weekly | `STRIPE_WEEKLY_PRODUCT_ID` | `STRIPE_WEEKLY_PRICE_ID` | `STRIPE_TRY_WEEKLY_PRICE_ID` |
| Monthly | `STRIPE_MONTHLY_PRODUCT_ID` | `STRIPE_MONTHLY_PRICE_ID` | `STRIPE_TRY_MONTHLY_PRICE_ID` |
| Annual | `STRIPE_ANNUAL_PRODUCT_ID` | `STRIPE_ANNUAL_PRICE_ID` | `STRIPE_TRY_ANNUAL_PRICE_ID` |

References: [Stripe products/prices](https://docs.stripe.com/products-prices/manage-prices), [create a price](https://docs.stripe.com/api/prices/create).

## 2. Generate the signing secrets

Run this twice and keep the two different outputs:

```sh
openssl rand -hex 32
```

Use the first output as `BILLING_GEO_SECRET` in both frontend and backend projects. Use the second as `BILLING_QUOTE_SECRET` in the backend only. These are application-generated secrets, not values from Stripe or Vercel. Generate a different pair for Preview and Production. Never add the `VITE_` prefix.

## 3. Prepare the backend configuration

Create/update `backend/.env.local` for local setup. Replace all illustrative values below with the actual IDs from the same Stripe environment:

```dotenv
STRIPE_SECRET_KEY=sk_test_YOUR_EXISTING_KEY
FRONTEND_APP_URL=http://localhost:5173
BILLING_PORTAL_RETURN_URL=http://localhost:5173/app/pricing

STRIPE_WEEKLY_PRODUCT_ID=prod_YourWeeklyProduct
STRIPE_MONTHLY_PRODUCT_ID=prod_YourMonthlyProduct
STRIPE_ANNUAL_PRODUCT_ID=prod_YourAnnualProduct
STRIPE_PRODUCT_ID=

STRIPE_WEEKLY_PRICE_ID=price_YourExistingUsdWeekly
STRIPE_MONTHLY_PRICE_ID=price_YourExistingUsdMonthly
STRIPE_ANNUAL_PRICE_ID=price_YourExistingUsdAnnual
STRIPE_TRY_WEEKLY_PRICE_ID=price_YourNewTryWeekly
STRIPE_TRY_MONTHLY_PRICE_ID=price_YourNewTryMonthly
STRIPE_TRY_ANNUAL_PRICE_ID=price_YourNewTryAnnual

BILLING_GEO_SECRET=YOUR_FIRST_GENERATED_SECRET
BILLING_QUOTE_SECRET=YOUR_SECOND_GENERATED_SECRET
BILLING_DEVELOPMENT_COUNTRY=TR
STRIPE_HISTORICAL_PRICES={}
PDF_OCR_LANGUAGES=eng+tur

STRIPE_USD_PORTAL_CONFIGURATION_ID=
STRIPE_TRY_PORTAL_CONFIGURATION_ID=
```

Your existing `STRIPE_SECRET_KEY` remains in use. If needed, find it in Stripe's **Developers / API keys** area for the selected environment. The setup command reads only Stripe-related settings and application URLs; Supabase and AI configuration are not required to create portal configurations. Process environment values override `.env.local`, which overrides `.env`.

`BILLING_DEVELOPMENT_COUNTRY` is your chosen local fixture: `TR` for Turkey or `US` for the global market. Production uses signed Vercel country context instead. Existing accounts with a saved billing market retain that market even in local tests; test initial market selection using a fresh unbilled account.

`STRIPE_HISTORICAL_PRICES` can remain `{}` because you retain the existing USD prices. If you retire prices later, copy those old `price_...` IDs from Stripe and map each to its plan, for example `{"price_RetiredMonthly":"monthly"}`. Accepted plan values are `weekly`, `monthly`, and `annual`; existing legacy Pro/lifetime variables remain separate.

`PDF_OCR_LANGUAGES=eng+tur` is a chosen OCR configuration, not an external ID; it enables English and Turkish recognition.

## 4. Create the two portal configurations

These are two settings profiles in the same Stripe account, not two new Stripe accounts or websites. They can share branding:

- USD configuration: offer only the three existing USD prices.
- TRY configuration: offer only the three new TRY prices.

Stripe documents [creating multiple portal configurations with its API](https://docs.stripe.com/customer-management/integrate-customer-portal#configure). The existing portal does not need to be deleted or modified.

To find the ID of your existing portal, run this read-only command (only `STRIPE_SECRET_KEY` is needed):

```sh
npm --prefix backend run stripe:regional-portals -- --list
```

It lists `bpc_...` IDs, whether each is the default/active configuration, and allowed Price IDs. You can reuse your existing configuration as `STRIPE_USD_PORTAL_CONFIGURATION_ID` if its enabled plan-change catalog contains exactly the three USD prices. Otherwise leave the variable blank and create a new regional configuration. The helper never modifies the old configuration.

From the repository root, first run the read-only validation:

```sh
npm --prefix backend run stripe:regional-portals
```

After all six prices validate, create the missing configurations:

```sh
npm --prefix backend run stripe:regional-portals -- --create
```

The command validates prices, creates/reuses the new regional configurations, and prints:

```dotenv
STRIPE_USD_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_TRY_PORTAL_CONFIGURATION_ID=bpc_...
```

Copy the printed IDs into the backend environment. The command does not change subscriptions, existing prices, existing portal configurations, default portal settings, environment files, or deployments. Reruns reuse matching configurations created by this helper. If you explicitly supply an existing portal ID, the command validates it instead of modifying it. Leave the ID blank to create a separate configuration.

Test the resulting configurations through the app's **Manage billing** action after setting the variables. Stripe Dashboard's default-portal preview may open the old default configuration instead of the market-specific configuration the app selects.

New configurations allow payment-method and billing-information updates, invoice history, cancellation at the end of the billing period, and plan changes within the same market. Quantity changes are disabled. Plan changes use Stripe's `create_prorations` policy; review the resulting amounts in Stripe's confirmation screen during test checkout. With three products, Stripe's “schedule downgrades at period end” feature cannot be used across those different products; this helper does not enable scheduled downgrades. See [Stripe portal settings](https://docs.stripe.com/customer-management/configure-portal).

For live creation, use the live Stripe key and live IDs, and set `FRONTEND_APP_URL` to your actual HTTPS application origin. The helper rejects live setup using localhost or HTTP. Portal IDs created in test mode must not be copied into the live configuration.

## 5. Add the variables to Vercel

Open each Vercel project → **Settings → Environment Variables**. Add values to the intended Preview or Production environment:

| Frontend project | Backend project |
| --- | --- |
| `BILLING_GEO_SECRET` only | The same `BILLING_GEO_SECRET`, `BILLING_QUOTE_SECRET`, all product/price/portal variables above, and existing backend variables |

Store signing secrets and Stripe secret keys as Secret variables. Price, product, and portal IDs can be Config variables. Keep existing USD Price IDs and webhook credentials. Set the frontend/application URLs to the matching deployment origins; existing checkout success/cancel and portal return URLs must use approved origins. Redeploy after changing deployment environment values. [Vercel environment-variable documentation](https://vercel.com/docs/environment-variables).

Apply the additive database migration and install the localized Supabase email templates as described in [the release guide](localization-regional-pricing-release.md). Configure/test the backend before deploying the localized frontend. TRY checkout remains disabled until all three TRY prices and the TRY portal validate.

The setup helper is provided for you to run after filling the IDs. No Stripe portal configuration or live deployment is created merely by adding this script to the repository.
