import { datadogLogs } from "@datadog/browser-logs";
import { datadogRum } from "@datadog/browser-rum-slim";
import {
  assertDatadogPublicConfig,
  type DatadogEnvSource,
  type DatadogPublicConfig,
} from "./config.ts";

export type ClientErrorContext = {
  operation: string;
};

let started: DatadogPublicConfig | null = null;

function browserEnvSource(): DatadogEnvSource {
  const env = import.meta.env;
  return {
    DD_APPLICATION_ID: env.DD_APPLICATION_ID,
    DD_CLIENT_TOKEN: env.DD_CLIENT_TOKEN,
    DD_SITE: env.DD_SITE,
    DD_SERVICE: env.DD_SERVICE,
    DD_ENV: env.DD_ENV,
    DD_VERSION: env.DD_VERSION,
    DD_REQUIRE: env.DD_REQUIRE,
  };
}

function hostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

/**
 * Start RUM + browser logs.  Missing or partial public keys stay dark
 * (including contactlogo.com).  Session Replay stays off.  Contact
 * payloads are never sent.
 *
 * trackUserInteractions is deliberately off (CL-23): Datadog derives click
 * action names from the clicked element's text/aria-label/alt, and the
 * clickable logo thumbnail is rendered as `<img alt="{contact display
 * name}">`.  `defaultPrivacyLevel: "mask-user-input"` only scrubs form
 * inputs, not derived action names, so leaving interaction tracking on
 * would ship contact names to Datadog RUM.  Rather than rely on a privacy
 * mode we cannot verify masks alt-derived names, the feature that derives
 * them stays disabled.
 *
 * Sample rates are non-100% on purpose: every page view still gets basic
 * RUM view/resource timing at a 20% session rate, which is enough to spot
 * regressions without shipping a browser-monitoring bill that scales
 * linearly with traffic.  Logs are sampled at 50%: `forwardErrorsToLogs`
 * only fires on actual errors, so this still leaves most incidents
 * visible while capping worst-case volume during an error storm.
 */
export function startDatadog(): DatadogPublicConfig | null {
  if (started) return started;
  const config = assertDatadogPublicConfig(browserEnvSource(), { hostname: hostname() });
  if (!config) return null;

  datadogRum.init({
    applicationId: config.applicationId,
    clientToken: config.clientToken,
    site: config.site,
    service: config.service,
    env: config.env,
    version: config.version,
    sessionSampleRate: 20,
    sessionReplaySampleRate: 0,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: false,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: [window.location.origin],
  });

  datadogLogs.init({
    clientToken: config.clientToken,
    site: config.site,
    service: config.service,
    env: config.env,
    version: config.version,
    sessionSampleRate: 50,
    forwardErrorsToLogs: true,
  });

  started = config;
  return config;
}

export function datadogStarted(): boolean {
  return started !== null;
}

/**
 * Error messages thrown inside this app routinely interpolate identifiers
 * that came from the user's address book (Google `resourceName`s, contact
 * display names embedded in fetch failures, etc. — see CL-23).  Rather than
 * try to enumerate every place that could happen, `reportClientError` never
 * forwards raw `error.message` text.  It forwards only the error's
 * constructor name (an allow-listed, closed set of built-in strings like
 * "TypeError" or "RangeError" — never derived from message content) plus
 * the caller-supplied, static `operation` label.  That is enough to triage
 * *where* something broke without risking *what* broke leaving the browser.
 */
const SAFE_ERROR_KIND = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export function errorKind(error: unknown): string {
  if (error instanceof Error && SAFE_ERROR_KIND.test(error.name)) {
    return error.name;
  }
  return "UnknownError";
}

export function reportClientError(error: unknown, context: ClientErrorContext): void {
  if (!started) return;
  const kind = errorKind(error);
  datadogLogs.logger.error(`Client error (${kind})`, { operation: context.operation });
}
