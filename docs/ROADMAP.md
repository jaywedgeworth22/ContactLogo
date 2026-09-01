# Roadmap

## Phase 0 — Foundation (this scaffold)
- [x] Product vision, architecture, matching-engine rulebook
- [x] `ContactLogoKit` package (models, normalize, rank, sources)
- [x] Catalog, phone directory, iconic sources, web review app
- [x] Single product name: ContactLogo
- [x] Golden test corpus (fixtures/golden-corpus.json with 86 conformance cases)
- [x] GitHub repo wiring, CI (web, kit, apple native builds, android)

## Phase 1 — macOS MVP
- [x] Contacts read via `Contacts.framework` + classification
- [x] Brandfetch source (Brand API search + Logo Link CDN, icon preference)
- [x] Review UI: Auto / Review / Not-found buckets, multi-candidate picker,
      select all/none, per-contact override
- [x] Apply + undo log
- [ ] Dogfood against the 14k-contact address book; log every correction
      back into MATCHING-ENGINE.md

## Phase 2 — iOS
- [x] Shared kit integration, Contacts permission flow
- [x] `BGProcessingTask` matching + completion notification
- [ ] Review UI adapted to small screen (swipe approve/reject?)
- [ ] TestFlight via existing App Store Connect account

## Phase 3 — Web
- [x] vCard / Google CSV parse → match → review → download
- [ ] Free quota + Stripe Pro
- [ ] Landing page, SEO ("add logos to contacts")

## Phase 4 — Polish & monetization
- [ ] Paywall (25 free contacts), Settings (own API keys)
- [ ] Scheduled re-scan ("new business contacts since last run")
- [ ] Alias/trap table updates shipped as remote config

## Logo licensing — SHIPPING GATE for all app stores

Third-party trademark assets are fetched from CDNs and bulk-applied to contacts.
Assets must be legal to redistribute in the app and on the user's device.
Platforms require clarity on intellectual property before review.

Required before any store submission:

- **Brandfetch Logo.dev CDN:** Verify terms permit in-app logo redistribution
  in vCards embedded on the user's device.  Review logo rights and termination
  conditions.
- **Logo.dev (via Brandfetch):** Same terms and IP coverage verification.
- **Simple Icons** (open source): Dual-licensed MIT + CC0 for the glyphs; verify
  that redistribution is permitted and documented in the privacy nutrition label.
- **Clearbit Logos CDN:** Review terms of service for in-app usage and data
  sourcing.
- **Wikimedia Commons:** Individual files have varying licenses (CC0, CC-BY,
  CC-BY-SA, public domain).  Determine whether bulk fetching respects the
  original licenses and whether attributions can be provided reasonably.
- **Google Favicon Service:** Verify terms permit fetching and embedding in the
  app's contact cards.

Responsible party: Product/Legal team.  Do not proceed to beta or store submission
without a signed licensing review from each provider.  Include license terms in
the privacy nutrition label.

## Open questions
- Google CSE cost beyond free tier vs. guiding users to bring their own key.
- App Store review stance on Contacts write access (needs clear value prop +
  privacy nutrition label; local-first helps).
