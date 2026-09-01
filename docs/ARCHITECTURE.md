# Architecture

## Shape

```
┌─────────────────────────────────────────────────────────┐
│                    ContactLogoKit (Swift)                 │
│  Contact scanning · Name normalization · Source clients  │
│  Candidate ranking · Confidence tiers · Write/undo log   │
└───────┬──────────────────┬──────────────────┬───────────┘
        │                  │                  │
 ContactLogoMac       ContactLogoiOS      ContactLogo Web
 (SwiftUI, full       (SwiftUI, BG        (vCard upload →
  power features)      ProcessingTask)     review →
                                            updated vCard)
```

- **One engine, three shells.** All matching logic lives in `ContactLogoKit`,
  a Swift package with zero platform-specific imports except a thin
  `ContactsProvider` protocol. macOS/iOS implement it over `Contacts.framework`;
  the web shell implements it over parsed vCards.
- **Web engine parity**: `web/src/engine` reimplements the same rules in
  TypeScript (MATCHING-ENGINE.md is the source of truth; Swift and TS tests
  cover the catalog/phone/classification cases).

## ContactLogoKit modules

| Module | Responsibility |
| --- | --- |
| `Models` | `ContactIdentity`, `LogoCandidate`, `Confidence`, `MatchResult`, `ChangeSet` (undo) |
| `Contacts` | `ContactsProvider` protocol; classification (person / business / non-brand) |
| `Normalize` | name cleaning, alias table, generic blocklist, domain derivation, company catalog + phone directory |
| `Identity` | website → work email → catalog → phone → flagged `{name}.com` guess |
| `Sources` | `LogoSource` protocol; preferred marks, Simple Icons, Brandfetch, Wikimedia, CompaniesLogo picker, favicon fallbacks |
| `Rank` | aspect/icon/alpha scoring, padding, similarity gate, top-N candidate list |
| `Pipeline` | orchestration → `MatchResult` with confidence tier (guess/favicon never HIGH) |
| `Store` | apply approved changes; persist undo log; persist the review queue (issue #32); shared `ReviewSession` |

## Data flow (native apps)

1. **Scan** (foreground, fast): read contacts, classify, normalize → work queue.
2. **Match** (network, slow): sources fetch candidates per queue item.
   iOS: `BGProcessingTaskRequest` (`requiresNetworkConnectivity`), continues
   overnight; local notification when the review queue is ready.
   macOS: immediate, with progress UI; optional scrape mode behind consent.
3. **Review**: three buckets (Auto / Review / Not-found). Multi-candidate
   picker, per-contact override (search/upload/paste URL), select-all/none.
4. **Apply**: batched `CNSaveRequest`; undo log written first.
5. **Undo**: restore prior images per batch.

## Web app (top-of-funnel)

- Upload `.vcf` → parse → same pipeline in the browser → review UI → download
  updated `.vcf`.
- Privacy: vCard held in memory only; deleted after download. No account
  needed for free tier.
- Stack: Vite + TypeScript engine in `web/src/engine`. Stripe Pro remains a
  later phase.

## Rate-limit & key policy

- Users may plug in their own Brandfetch/Google CSE keys (Settings).
- Shared free-tier keys are server-side only (web app), quota-limited per IP.
- Rate-limited sources (Brandfetch, Wikimedia) throw `LogoSourceError.rateLimited`
  on HTTP 429; `HTTPRetry` with exponential backoff (base 500 ms, doubling,
  full jitter, 3 attempts) retries; final failure is logged via `SourceFailure`.
  See `Sources/HTTPRetry.swift` and `Sources/BrandfetchSource.swift`.

## Testing strategy

- **Golden corpus**: fixture in `fixtures/golden-corpus.json` with 86 conformance
  cases covering the trap examples in MATCHING-ENGINE.md §4 (nonbrand generics,
  social hosts, subdomains, homonyms, legal suffixes, brand tails, etc.).
  Language-neutral specification; all three engines (Swift, TypeScript, Kotlin)
  must produce identical results for each case.  Planned: add CI assertion to
  catch engine drift.
- Ranking unit tests for aspect/icon/padding rules.
- `ContactsProvider` mock for pipeline tests.
