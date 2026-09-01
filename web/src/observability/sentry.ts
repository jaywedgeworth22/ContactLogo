/**
 * Sentry client observability for ContactLogo.
 *
 * Gated on VITE_SENTRY_DSN (inlined by Vite at build time).
 * Completely inert in dev/CI when no DSN is provided.
 *
 * Vanilla Vite (not React) — same helper pattern as DealDex/BotFleet
 * using @sentry/browser.
 *
 * - Session Replay 100% on error, 10% baseline session
 * - maskAllText / blockAllMedia (address-book UI)
 * - User Feedback widget (consumer web UI)
 * - sendDefaultPii false; no contact names in telemetry
 */

import * as Sentry from "@sentry/browser";

let initialized = false;

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
}

export function startSentry(): void {
  if (initialized || typeof window === "undefined") return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;

  const env =
    (import.meta.env.VITE_SENTRY_ENV as string | undefined)?.trim() ||
    (import.meta.env.MODE as string | undefined) ||
    "production";

  const tracesSampleRate = Number(
    (import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined)?.trim() ??
      "0.2",
  );
  const replayRaw = (
    import.meta.env.VITE_SENTRY_REPLAY_ENABLED as string | undefined
  )?.trim();
  const replayDisabled = replayRaw
    ? /^(false|0|off|no)$/i.test(replayRaw)
    : false;
  const replaysSessionSampleRate = Number(
    (
      import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE as string | undefined
    )?.trim() ?? "0.1",
  );
  const replaysOnErrorSampleRate = Number(
    (
      import.meta.env.VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE as string | undefined
    )?.trim() ?? "1.0",
  );

  Sentry.init({
    dsn,
    environment: env,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? Math.min(Math.max(tracesSampleRate, 0), 1)
      : 0.2,
    enableLogs: true,
    replaysSessionSampleRate:
      !replayDisabled && Number.isFinite(replaysSessionSampleRate)
        ? replaysSessionSampleRate
        : 0,
    replaysOnErrorSampleRate:
      !replayDisabled && Number.isFinite(replaysOnErrorSampleRate)
        ? replaysOnErrorSampleRate
        : 0,
    beforeSend(event) {
      delete event.extra;
      if (event.request) {
        event.request = {
          url: stripQuery(event.request.url),
          method: event.request.method,
        };
      }
      return event;
    },
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
        autoInject: true,
      }),
      ...(!replayDisabled
        ? [
            Sentry.replayIntegration({
              maskAllText: true,
              blockAllMedia: true,
            }),
          ]
        : []),
    ],
  });

  initialized = true;
}

export function sentryStarted(): boolean {
  return initialized;
}

/**
 * Count a finished logo match pass.  `n` is the number of contacts that
 * produced a suggestion (not skip).  Never sends names, emails, or domains.
 */
export function countLogoMatch(n: number): void {
  if (!initialized || n <= 0) return;
  try {
    Sentry.metrics.count("logo.match", n);
  } catch {
    // Telemetry must never break matching.
  }
}

export const captureException = Sentry.captureException;
export const captureMessage = Sentry.captureMessage;
