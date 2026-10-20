# Employer checkout and mandatory onboarding contract

## Product selection
The public workforce.screenings4u.com catalog must ask employers to choose **DOT** or **NON-DOT** before checkout. Tier pricing is the same (Essential $85, Professional $145, Enterprise $245/month), but purchased program entitlement is persisted immutably on the checkout intent and resulting subscription item. Do not infer program entitlement from the shared Workforce plan's supported_programs; that metadata describes *available* offerings, not what was purchased.

## Checkout rules
- Buyer chooses employer / C/TPA / FMCSA owner-operator.
- Employer chooses DOT or NON-DOT, then tier. DOT agency selection occurs at mandatory post-payment onboarding. NON-DOT must never be assigned DOT modules.
- C/TPA subscription includes DOT and NON-DOT workspaces under one C/TPA account; never duplicate charge.
- Owner-operator offers DOT FMCSA yearly tiers only.
- Stripe Checkout or PaymentIntent metadata includes immutable purchase reference, audience, purchased_program, plan_id, price and frequency. Backend validates against server-owned catalog, never trusts client price or program choice alone.
- Preserve legacy Stripe subscription IDs, existing billing continuity, and existing portal access. Prevent duplicate provisioning on webhook retries and repeated onboarding submissions.

## Mandatory post-purchase blocker
After Stripe webhook verifies payment, route customer to secure onboarding in `pending_onboarding` state. Require authentication or a short-lived signed intake token bound to that verified purchase. A frontend route alone is not a security boundary: every protected employer API must deny privileged application features until backend onboarding state is completed.
- Required for all: verified employer organization identity, administrator contact, employer role/tenant association.
- DOT buyer: choose FMCSA, FAA, FRA, FTA, PHMSA or USCG, verify regulatory employer details according to the selected agency; can support multiple DOT agencies as separate authorized program associations if the organization qualifies.
- NON-DOT buyer: **no DOT agency question**, no DOT number requirement, do not create DOT entitlements or allow DOT modules.
- On completion, server writes purchased_program, validated agency memberships, onboarding status, and portal grants atomically. Idempotent retry on duplicate completion.
- Use a single Employer portal role but filter sidebar, queries, endpoints and documents according to purchased_program and agency. Return 403 for DOT-only actions when only NON-DOT was purchased.
- Employees and drivers are invited by their employer, scoped to that employer and relevant assigned program; no independent subscription.
- First login always checks backend onboarding state and diverts incomplete accounts to blocker. Do not redirect based on text in an API error message.

## Backend changes needed before go-live
`workforce-checkout` currently serves legacy DOT `plans` and hardcodes DOT Stripe catalog source; `nondot-checkout` serves `workforce_plans` with NON_DOT metadata. These must be unified and webhook/provisioning checked together, not rewritten as marketing redirects.
`nondot-checkout-status` currently reports agency_select:false and directly provisions NON_DOT, while `workforce-workspaces` uses legacy DOT `subscriptions`. Introduce a central subscription entitlement resolver to prevent accidental cross-program access.
No production checkout routing changes until end-to-end paid and trial tests, Stripe idempotency, entitlement denial, and legacy customer fallback are verified.
