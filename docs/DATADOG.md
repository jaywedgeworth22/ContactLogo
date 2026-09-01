# Datadog on ContactLogo

Uses the existing fleet Datadog account (`DD_SITE=us5.datadoghq.com`).  No
new org, no invented secrets in git, no Session Replay, no Designer UX, no
Oracle RAG.  Sentry and PagerDuty stay as-is when those keys exist.

## Surfaces

| Surface | What ships | Notes |
|---|---|---|
| ContactLogo Web (Vercel) | Browser logs + RUM only | UI exists.  Init in `web/src/observability/datadog.ts`.  Vercel is a serverless CDN, not a Node runtime. |
| Local development server | `dd-trace` APM + JSON stdout logs | `web/server.mjs` and `npm start`.  Agent on `DD_AGENT_HOST:DD_TRACE_AGENT_PORT`.  Not the production path. |
| macOS / iOS | none in this change | No local Mac/iOS ship from this work. |
| Android | none in this change | Native RUM can reuse the same public RUM env later. |

## Existing env vars (reuse; do not invent new names)

Set these in Coolify / Infisical.  Never commit values.

| Name | Where | Purpose |
|---|---|---|
| `DD_APPLICATION_ID` | Web build | Existing RUM application id |
| `DD_CLIENT_TOKEN` | Web build | Existing RUM/logs client token (public) |
| `DD_SITE` | Web + server | Default `us5.datadoghq.com` |
| `DD_SERVICE` | Web + server | Default `contactlogo-web` |
| `DD_ENV` | Web + server | `production` warns and stays dark without keys |
| `DD_VERSION` | Web + server | Optional release tag |
| `DD_REQUIRE` | Web + server | `1` forces the stay-dark warning on any host |
| `DD_API_KEY` | Server only | Existing account API key.  Never bundled into Vite. |
| `DD_AGENT_HOST` | Server | Default `127.0.0.1` (host agent) |
| `DD_TRACE_AGENT_PORT` | Server | Default `8126` |

`VITE_DD_*` aliases are accepted at build time and mapped onto the same `DD_*`
names.  `DD_API_KEY` is not an alias and is never exposed to the browser.

RUM ids are baked in at `vite build`.  Coolify must pass `DD_APPLICATION_ID`
and `DD_CLIENT_TOKEN` as build-time env (see `web/Dockerfile` `ARG`s), not
only as runtime secrets.

## Stay dark

- `vite build` with `DD_ENV=production` (or `DD_REQUIRE=1`) warns if
  `DD_APPLICATION_ID` or `DD_CLIENT_TOKEN` is missing and still emits
  `dist/`.
- Browser boot on `contactlogo.com` / `www.contactlogo.com` leaves RUM
  dark and still renders the app.
- `node server.mjs` with `DD_ENV=production` or `NODE_ENV=production`
  leaves APM dark if `DD_API_KEY` is missing and still serves `dist/`.
- Local `npm run dev`, CI `npm test`, and CI `npm run build` stay open so
  agents can work without production secrets.

## Cost

Session Replay sample rate is `0`.  Server APM samples 20% in production
(100% of errors still flow through logs).  Do not create a second Datadog
organization or extra RUM apps for this product.
