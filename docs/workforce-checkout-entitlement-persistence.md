# Checkout persistence patch for deployment

Live checkout function `nondot-checkout` is version 28. Production replacement was not applied: deployment request was blocked. Implement this through the checked-in Supabase function source and verified deployment pipeline.

## Required edits
1. In `workforce_checkout_intents.insert`, add `purchased_program: p.audience === "ctpa" ? "DOT_AND_NON_DOT" : "NON_DOT"`.
2. Include the same value in checkout-intent `metadata`, Stripe Checkout session metadata, and `subscription_data.metadata`.
3. In `nondot-checkout-status` provisioning, copy `iq.data.purchased_program` to `workforce_subscriptions.purchased_program` and `workforce_purchase_intakes.purchased_program`. For historical intents, use the authenticated legacy NON-DOT flow as explicit migration fallback, never infer program from `supported_programs`.
4. Validate that the program matches `account_type` and purchased catalog before Stripe session creation and subscription activation.
5. Treat a completed or existing Stripe subscription/intent idempotently; do not create duplicate invoices or subscriptions.
6. For DOT employer checkout, integrate server-validated DOT purchase and mandatory agency onboarding in a dedicated versioned cutover. DOT implies DOT + NON-DOT permission; NON-DOT implies NON-DOT only; owner operator does not inherit employer portal permission.
7. Test Stripe session metadata, webhook fulfillment, incomplete-onboarding denial, direct URL authorization checks, and existing lifetime complimentary accounts before switching marketing site routes.

## Current schema
`workforce_checkout_intents.purchased_program`, `workforce_purchase_intakes.purchased_program`, and `workforce_subscriptions.purchased_program` now exist with account-type validation constraints. Existing subscriptions remain NULL pending migration reconciliation. Do not backfill without audited evidence.
