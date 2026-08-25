/** Fleet Datadog public env names.  Never read DD_API_KEY here. */

export const DATADOG_SITES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
  "ap1.datadoghq.com",
] as const;

export type DatadogSite = (typeof DATADOG_SITES)[number];

export const DEFAULT_DD_SITE: DatadogSite = "us5.datadoghq.com";
export const DEFAULT_DD_SERVICE = "contactlogo-web";

export type DatadogPublicConfig = {
  applicationId: string;
  clientToken: string;
  site: DatadogSite;
  service: string;
  env: string;
  version: string;
};

export type DatadogEnvSource = {
  DD_APPLICATION_ID?: string;
  DD_CLIENT_TOKEN?: string;
  DD_SITE?: string;
  DD_SERVICE?: string;
  DD_ENV?: string;
  DD_VERSION?: string;
  DD_REQUIRE?: string;
};

export function trimEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

export function isDatadogSite(value: string): value is DatadogSite {
  return (DATADOG_SITES as readonly string[]).includes(value);
}

export function resolveDatadogSite(raw: string | undefined): DatadogSite {
  const site = trimEnv(raw) || DEFAULT_DD_SITE;
  if (isDatadogSite(site)) return site;
  throw new Error(`Unsupported DD_SITE: ${site}`);
}

export function readDatadogPublicEnv(source: DatadogEnvSource): {
  config: DatadogPublicConfig | null;
  missing: string[];
} {
  const applicationId = trimEnv(source.DD_APPLICATION_ID);
  const clientToken = trimEnv(source.DD_CLIENT_TOKEN);
  const missing: string[] = [];
  if (!applicationId) missing.push("DD_APPLICATION_ID");
  if (!clientToken) missing.push("DD_CLIENT_TOKEN");
  if (missing.length > 0) {
    return { config: null, missing };
  }
  return {
    config: {
      applicationId,
      clientToken,
      site: resolveDatadogSite(source.DD_SITE),
      service: trimEnv(source.DD_SERVICE) || DEFAULT_DD_SERVICE,
      env: trimEnv(source.DD_ENV) || "development",
      version: trimEnv(source.DD_VERSION) || "unknown",
    },
    missing,
  };
}

export function productionHostname(hostname: string | undefined): boolean {
  const host = trimEnv(hostname).toLowerCase();
  switch (host) {
    case "contactlogo.com":
    case "www.contactlogo.com":
      return true;
    default:
      return false;
  }
}

export function datadogIsRequired(input: {
  env?: string;
  hostname?: string;
  requireFlag?: string;
}): boolean {
  if (trimEnv(input.requireFlag) === "1") return true;
  if (trimEnv(input.env) === "production") return true;
  return productionHostname(input.hostname);
}

export function assertDatadogPublicConfig(
  source: DatadogEnvSource,
  runtime: { hostname?: string } = {},
): DatadogPublicConfig | null {
  const { config, missing } = readDatadogPublicEnv(source);
  const required = datadogIsRequired({
    env: source.DD_ENV,
    hostname: runtime.hostname,
    requireFlag: source.DD_REQUIRE,
  });
  if (config) return config;
  if (!required) return null;
  throw new Error(
    `Datadog keys missing (${missing.join(", ")}).  Refusing to start.`,
  );
}
