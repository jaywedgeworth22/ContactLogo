import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));

function startServer(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`server did not start: ${stderr || stdout}`));
    }, 8000);
    const onData = (chunk) => {
      stdout += String(chunk);
      if (/listening on/.test(stdout)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolvePromise({ child, stderr, stdout });
      }
    };
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code && code !== 0 && !/listening on/.test(stdout)) {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}: ${stderr || stdout}`));
      }
    });
  });
}

function stopServer(child) {
  return new Promise((resolvePromise) => {
    child.on("exit", () => resolvePromise());
    child.kill("SIGTERM");
  });
}

test("Coolify host starts without DD_API_KEY in production", async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const { child, stdout } = await startServer({
    NODE_ENV: "production",
    DD_ENV: "production",
    DD_API_KEY: "",
    DD_AGENT_HOST: "",
    PORT: String(port),
  });
  try {
    assert.match(stdout, /APM stays dark/);
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    await stopServer(child);
  }
});

test("malformed percent-escape returns 400 with a fixed body, not the raw URIError", async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const { child } = await startServer({
    NODE_ENV: "production",
    DD_ENV: "production",
    DD_API_KEY: "",
    DD_AGENT_HOST: "",
    PORT: String(port),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/%`);
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.equal(text, "bad request");
    assert.doesNotMatch(text, /URI malformed/i);
  } finally {
    await stopServer(child);
  }
});
