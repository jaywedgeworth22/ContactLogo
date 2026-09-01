/**
 * Lightweight browser Sentry client observability for ContactLogo Web.
 *
 * Gated on VITE_SENTRY_DSN. Inert in dev/CI when unset.
 * Captures unhandled window errors and promise rejections with URL and
 * credential sanitization.
 */

let initialized = false;

function parseDsn(dsn: string): { host: string; projectId: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const pathParts = url.pathname.split("/").filter(Boolean);
    const projectId = pathParts[pathParts.length - 1];
    if (!publicKey || !projectId) return null;
    return { host: url.host, projectId, publicKey };
  } catch {
    return null;
  }
}

function sanitizeText(text: string): string {
  return text
    .replace(/(?:key|secret|token|auth|password|api[_-]?key)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/(?:bearer\s+)[a-zA-Z0-9_\-\.]{20,}/gi, "Bearer [REDACTED]");
}

export function startSentry(): void {
  if (initialized || typeof window === "undefined") return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const env = (import.meta.env.VITE_SENTRY_ENV as string | undefined)?.trim() || "production";
  const endpoint = `https://${parsed.host}/api/${parsed.projectId}/envelope/?sentry_key=${parsed.publicKey}&sentry_version=7`;

  const sendError = (error: Error | string, mechanism = "onerror") => {
    try {
      const message = typeof error === "string" ? error : error.message || "Unknown error";
      const stack = error instanceof Error ? error.stack : undefined;
      const eventId = crypto.randomUUID().replace(/-/g, "");

      const header = JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
        dsn,
      });

      const itemHeader = JSON.stringify({
        type: "event",
        content_type: "application/json",
      });

      const eventPayload = JSON.stringify({
        event_id: eventId,
        timestamp: Date.now() / 1000,
        platform: "javascript",
        environment: env,
        level: "error",
        exception: {
          values: [
            {
              type: error instanceof Error ? error.name : "Error",
              value: sanitizeText(message),
              stacktrace: stack ? { frames: [{ filename: sanitizeText(stack) }] } : undefined,
              mechanism: { handled: false, type: mechanism },
            },
          ],
        },
      });

      const envelope = `${header}\n${itemHeader}\n${eventPayload}`;

      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, envelope);
      } else {
        fetch(endpoint, {
          method: "POST",
          body: envelope,
          mode: "cors",
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Fail-soft
    }
  };

  window.addEventListener("error", (event) => {
    sendError(event.error || event.message, "onerror");
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendError(event.reason instanceof Error ? event.reason : String(event.reason), "onunhandledrejection");
  });

  initialized = true;
}
