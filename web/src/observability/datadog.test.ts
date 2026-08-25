import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDatadogPublicConfig,
  datadogIsRequired,
  DEFAULT_DD_SERVICE,
  DEFAULT_DD_SITE,
  productionHostname,
  readDatadogPublicEnv,
  resolveDatadogSite,
} from "./config.ts";

test("production hostnames require Datadog", () => {
  assert.equal(productionHostname("contactlogo.com"), true);
  assert.equal(productionHostname("www.contactlogo.com"), true);
  assert.equal(productionHostname("localhost"), false);
  assert.equal(productionHostname("contact-logo.grok.me"), false);
});

test("fail closed when production env is set", () => {
  assert.equal(datadogIsRequired({ env: "production" }), true);
  assert.equal(datadogIsRequired({ env: "development" }), false);
  assert.equal(datadogIsRequired({ requireFlag: "1" }), true);
  assert.equal(datadogIsRequired({ hostname: "contactlogo.com" }), true);
});

test("reads existing fleet public env names", () => {
  const { config, missing } = readDatadogPublicEnv({
    DD_APPLICATION_ID: " app-id ",
    DD_CLIENT_TOKEN: " pubtoken ",
    DD_SITE: "us5.datadoghq.com",
    DD_SERVICE: "contactlogo-web",
    DD_ENV: "production",
    DD_VERSION: "1.0.0",
  });
  assert.deepEqual(missing, []);
  assert.deepEqual(config, {
    applicationId: "app-id",
    clientToken: "pubtoken",
    site: "us5.datadoghq.com",
    service: "contactlogo-web",
    env: "production",
    version: "1.0.0",
  });
});

test("defaults site and service to the existing US5 account", () => {
  const { config } = readDatadogPublicEnv({
    DD_APPLICATION_ID: "app-id",
    DD_CLIENT_TOKEN: "pubtoken",
  });
  assert.equal(config?.site, DEFAULT_DD_SITE);
  assert.equal(config?.service, DEFAULT_DD_SERVICE);
  assert.equal(config?.env, "development");
  assert.equal(resolveDatadogSite(""), DEFAULT_DD_SITE);
});

test("dev without keys is a no-op; production without keys throws", () => {
  const empty = readDatadogPublicEnv({});
  assert.equal(empty.config, null);
  assert.deepEqual(empty.missing, ["DD_APPLICATION_ID", "DD_CLIENT_TOKEN"]);
  assert.equal(assertDatadogPublicConfig({}), null);
  assert.throws(
    () =>
      assertDatadogPublicConfig(
        { DD_ENV: "production" },
        { hostname: "localhost" },
      ),
    /DD_APPLICATION_ID/,
  );
});

test("unsupported DD_SITE fails closed", () => {
  assert.throws(() => resolveDatadogSite("not-a-datadog-site"), /Unsupported DD_SITE/);
});
