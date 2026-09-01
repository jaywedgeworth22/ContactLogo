import { defineConfig, type Plugin, type UserConfig } from "vite";
import { handleLogoGet } from "./src/engine/logo-cache.ts";
import {
  assertDatadogPublicConfig,
  type DatadogEnvSource,
} from "./src/observability/config.ts";

function logoCachePlugin(): Plugin {
  const serve = async (req: { method?: string; url?: string; headers: NodeJS.Dict<string | string[]> }, res: {
    statusCode: number;
    setHeader: (k: string, v: string | number) => void;
    end: (b?: string | Buffer) => void;
  }, next: () => void) => {
    const raw = req.url ?? "";
    const path = raw.split("?")[0] ?? "";
    if (!path.startsWith("/api/logo/")) {
      next();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const request = new Request(new URL(raw, "http://vite.local"), {
      method: req.method || "GET",
      headers,
    });
    const response = await handleLogoGet(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  };
  return {
    name: "contactlogo-logo-cache",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void serve(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void serve(req, res, next);
      });
    },
  };
}

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
    plugins: [logoCachePlugin()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
