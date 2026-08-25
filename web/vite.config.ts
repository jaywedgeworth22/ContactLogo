import { defineConfig, type UserConfig } from "vite";
import {
  assertDatadogPublicConfig,
  type DatadogEnvSource,
} from "./src/observability/config.ts";

function publicDatadogSource(): DatadogEnvSource {
  const from = (name: keyof DatadogEnvSource): string => {
    const direct = process.env[name];
    const vitePrefixed = process.env[`VITE_${name}`];
    return (direct ?? vitePrefixed ?? "").trim();
  };
  return {
    DD_APPLICATION_ID: from("DD_APPLICATION_ID"),
    DD_CLIENT_TOKEN: from("DD_CLIENT_TOKEN"),
    DD_SITE: from("DD_SITE"),
    DD_SERVICE: from("DD_SERVICE"),
    DD_ENV: from("DD_ENV"),
    DD_VERSION: from("DD_VERSION"),
    DD_REQUIRE: from("DD_REQUIRE"),
  };
}

function datadogDefines(source: DatadogEnvSource): Record<string, string> {
  const keys: (keyof DatadogEnvSource)[] = [
    "DD_APPLICATION_ID",
    "DD_CLIENT_TOKEN",
    "DD_SITE",
    "DD_SERVICE",
    "DD_ENV",
    "DD_VERSION",
    "DD_REQUIRE",
  ];
  const defines: Record<string, string> = {};
  for (const key of keys) {
    defines[`import.meta.env.${key}`] = JSON.stringify(source[key] ?? "");
  }
  return defines;
}

export default defineConfig(({ command }): UserConfig => {
  const source = publicDatadogSource();
  if (command === "build") {
    assertDatadogPublicConfig(source);
  }
  return {
    root: ".",
    publicDir: "public",
    define: datadogDefines(source),
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
