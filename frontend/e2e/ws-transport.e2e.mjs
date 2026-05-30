/**
 * End-to-end test of the real browser -> WebSocket -> backend transport.
 *
 * Orchestrates the whole stack and drives a real Chrome:
 *   1. boots the backend WS server (tsx src/server/index.ts) on E2E_WS_PORT
 *   2. boots a Vite dev server with VITE_MCP_WS_URL pointed at it
 *   3. launches the system Chrome via puppeteer-core (no Chromium download)
 *   4. pastes the offline stub config, opens the workspace, and asserts:
 *        - the canvas transport chip reads "backend live" (socket open)
 *        - the catalog lists the stub's `echo` tool (real connect round-trip)
 *        - running `echo` over the socket returns the real "Echo: ..." envelope
 *
 * Run:  npm run test:e2e        (from the frontend/ folder)
 * Env:  CHROME_PATH  override the Chrome executable
 *       E2E_WS_PORT  backend port (default 8790)
 *       E2E_UI_PORT  vite port (default 5199)
 *
 * Manual "real-everything" smoke (no stub): in backend/ run `npm run serve`,
 * in frontend/ set VITE_MCP_WS_URL=ws://localhost:8787 and `npm run dev`, then
 * upload a config that uses `npx -y @modelcontextprotocol/server-everything`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(here, "..");
const repoRoot = path.join(frontendDir, "..");
const backendDir = path.join(repoRoot, "backend");

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WS_PORT = process.env.E2E_WS_PORT || "8790";
const UI_PORT = process.env.E2E_UI_PORT || "5199";
const WS_URL = `ws://localhost:${WS_PORT}`;

const tsxBin = path.join(backendDir, "node_modules", ".bin", "tsx");
const stubPath = path.join(backendDir, "test", "fixtures", "stub-mcp-server.ts");
const stubConfig = {
  servers: [{ name: "everything", command: tsxBin, args: [stubPath] }],
};

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      // Children are spawned detached (group leaders), so kill the whole group
      // to take down grandchildren (e.g. vite spawned by npm) too.
      if (c.pid) process.kill(-c.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function waitForOutput(child, regex, label, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      timeoutMs,
    );
    const onData = (d) => {
      buf += d.toString();
      if (regex.test(buf)) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve(buf);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited early (code ${code})`));
    });
  });
}

async function clickByText(page, tag, text, timeoutMs = 15_000) {
  await page.waitForFunction(
    (tag, text) =>
      [...document.querySelectorAll(tag)].some(
        (e) => e.textContent && e.textContent.toLowerCase().includes(text.toLowerCase()),
      ),
    { timeout: timeoutMs },
    tag,
    text,
  );
  const handle = await page.evaluateHandle(
    (tag, text) =>
      [...document.querySelectorAll(tag)].find(
        (e) => e.textContent && e.textContent.toLowerCase().includes(text.toLowerCase()),
      ) || null,
    tag,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No <${tag}> containing "${text}"`);
  await el.click();
}

async function setTextareaValue(page, selector, value) {
  await page.evaluate(
    (selector, value) => {
      const el = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function main() {
  // 1. Backend WS server.
  const backend = spawn(tsxBin, ["src/server/index.ts"], {
    cwd: backendDir,
    env: { ...process.env, MCP_WS_PORT: WS_PORT },
    detached: true,
  });
  children.push(backend);
  backend.stderr.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  await waitForOutput(backend, /listening on/, "backend WS server");

  // 2. Vite dev server with the WS transport enabled.
  const vite = spawn("npm", ["run", "dev", "--", "--port", UI_PORT, "--strictPort"], {
    cwd: frontendDir,
    env: { ...process.env, VITE_MCP_WS_URL: WS_URL },
    detached: true,
  });
  children.push(vite);
  vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  await waitForOutput(vite, new RegExp(`localhost:${UI_PORT}`), "vite dev server");

  // 3. Browser.
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`[browser console.error] ${m.text()}`);
    });
    await page.goto(`http://localhost:${UI_PORT}`, { waitUntil: "domcontentloaded" });

    // Paste the stub config and open the workspace.
    await clickByText(page, "button", "paste JSON");
    await page.waitForSelector('textarea[aria-label="Paste mcp-config.json"]');
    await setTextareaValue(
      page,
      'textarea[aria-label="Paste mcp-config.json"]',
      JSON.stringify(stubConfig, null, 2),
    );
    await clickByText(page, "button", "Open Workspace");

    // Connect round-trip: socket open + real catalog from the spawned stub.
    await page.waitForFunction(() => document.body.innerText.includes("backend live"), {
      timeout: 20_000,
    });
    await page.waitForFunction(() => /\becho\b/.test(document.body.innerText), {
      timeout: 20_000,
    });
    console.log('PASS: connected over WS; transport "backend live"; catalog lists echo');

    // Run the echo tool over the socket and read the real result envelope.
    await clickByText(page, "button", "echo");
    await page.waitForSelector('input[placeholder="text"]', { timeout: 10_000 });
    await page.type('input[placeholder="text"]', "hello ws");
    await page.click('button[aria-label="Run tool"]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("pre")]
          .map((p) => p.innerText)
          .join("\n")
          .includes("Echo: hello ws"),
      { timeout: 15_000 },
    );
    console.log('PASS: tool call over WS returned "Echo: hello ws"');

    console.log("\nE2E OK");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nE2E FAILED:", err.message);
    cleanup();
    process.exit(1);
  });
