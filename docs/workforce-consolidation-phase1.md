# Workforce consolidation: phase 1 inventory and compatibility contract (2026-10-20)

## Live inventory
Supabase project: elpbnytpciqnbexiaebp.
418 deployed Edge Functions: 138 with standalone DOT tokens, 66 with NONDOT tokens, 35 prefixed workforce-. Names alone do not imply safe deletion or identical behavior.
Legacy `public.plans`: 31 records; legacy `public.subscriptions`: 40 records.
`public.workforce_plans`: 6 employer and C/TPA tiers; `public.workforce_subscriptions`: 17 records at time of audit.
Workforce subscription breakdown: 8 active monthly, 8 trial monthly, 1 active lifetime.
All six Workforce plans still encode `billing_model.program = NON_DOT`; do not simply relabel these to DOT-inclusive until entitlement and compliance semantics are implemented.
Existing Workforce tier pricing matches generic legacy DOT employer/C/TPA levels:
Employer Essential $85, Professional $145, Enterprise $245/month;
C/TPA Essential $125, Professional $225, Enterprise $375/month.
DOT agency-specific FAA/FMCSA/FRA/FTA/PHMSA/USCG, owner-operator, sponsorship, and testing plans need distinct entitlement mappings; do not discard them.

## Target contract
- Account authority: one authenticated Workforce identity / employer or C/TPA organization / membership.
- Billing authority: Workforce subscription + items and immutable Stripe IDs; explicitly represent complimentary lifetime grants.
- Entitlements: independent audience, tier, program flags (DOT, NON_DOT), agencies and enabled modules.
- Retain portal codes and existing portal URLs as compatibility identities; no blanket granting access across programs.
- Keep DOT regulated workflows separate in domain logic where their regulatory rules differ (FMCSA, FAA, FRA, FTA, PHMSA, USCG).
- Edge functions: consolidate implementation behind Workforce functions in feature groups; legacy function names may temporarily proxy to unified handlers while all callers migrate.

## Execution gates
1. Snapshot and reconcile 40 legacy subscriptions against 17 Workforce subscriptions using tenant, employer, Stripe IDs, plan and billing status. Identify conflicts and orphaned accounts BEFORE migrating rows.
2. Record every legacy function's source, callers, DB objects, permissions and equivalent Workforce endpoint. Distinguish HTTP wrappers from actual regulated logic.
3. Add shared Workforce access/subscription resolution and test trial, paid, lifetime, revoked, employer, C/TPA, DOT-only and NON_DOT-only scenarios.
4. Update portals incrementally with dual-compatible endpoint routing; observe error rates and authorization results.
5. Only then retire each function whose callers have been switched and whose routes have passed tests. Do not mass-delete.
6. Finally consolidate marketing to workforce.screenings4u.com; consider app.screenings4u.com only after auth and entitlements are stable.

## Preserved customer access
An authorized complimentary lifetime Workforce Employer Enterprise subscription exists for Erika Williams's employer. Do not convert it into paid billing or remove it during migration.

## Immediate next implementation
Build a read-only reconciliation report of legacy vs Workforce plans/subscriptions and a dependency catalog from the GitHub portal repos plus deployed function source. Changes to live billing schema/functions follow successful reconciliation.
