import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));

function runServer(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`server did not exit: ${stderr || stdout}`));
    }, 8000);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr, stdout });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test("Coolify host fails closed without DD_API_KEY in production", async () => {
  const result = await runServer({
    NODE_ENV: "production",
    DD_ENV: "production",
    DD_API_KEY: "",
    DD_AGENT_HOST: "",
    PORT: "0",
  });
  assert.notEqual(result.code, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /DD_API_KEY missing/);
});
