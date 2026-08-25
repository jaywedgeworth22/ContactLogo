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
 * Start RUM + browser logs.  Production (contactlogo.com or DD_ENV=production)
 * fails closed when DD_APPLICATION_ID / DD_CLIENT_TOKEN are missing.
 * Session Replay stays off.  Contact payloads are never sent.
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
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: [window.location.origin],
  });

  datadogLogs.init({
    clientToken: config.clientToken,
    site: config.site,
    service: config.service,
    env: config.env,
    version: config.version,
    sessionSampleRate: 100,
    forwardErrorsToLogs: true,
  });

  started = config;
  return config;
}

export function datadogStarted(): boolean {
  return started !== null;
}

export function reportClientError(error: unknown, context: ClientErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!started) return;
  datadogLogs.logger.error(message, { operation: context.operation });
}
