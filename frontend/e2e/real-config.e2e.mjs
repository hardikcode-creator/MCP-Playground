/**
 * Real end-to-end browser test against the ACTUAL MCP servers in
 * examples/mcp-config3.json (airbnb + zomato), exercising the frontend's
 * WebSocket transport, Pane-3 tool runner, and the workflow canvas
 * (import + run with $ref) — all rendered in real Chrome.
 *
 * Needs outbound network (npx airbnb server + zomato mcp-remote).
 * Run:  node e2e/real-config.e2e.mjs   (from frontend/)
 */
import { readFileSync } from "node:fs";
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
const WS_PORT = process.env.E2E_WS_PORT || "8791";
const UI_PORT = process.env.E2E_UI_PORT || "5198";
const WS_URL = `ws://localhost:${WS_PORT}`;
const tsxBin = path.join(backendDir, "node_modules", ".bin", "tsx");

const realConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "mcp-config3.json"), "utf8"),
);

const refPath = "$.structuredContent.result.addresses[0].address_id";
const importWf = {
  id: "wf-ui",
  version: 1,
  nodes: [
    { id: "addr", tool: "zomato-mcp__get_saved_addresses_for_user", args: {}, dependsOn: [], breakpoint: false },
    {
      id: "search",
      tool: "zomato-mcp__get_restaurants_for_keyword",
      args: { address_id: { $ref: { nodeId: "addr", path: refPath } }, keyword: "pizza" },
      dependsOn: ["addr"],
      breakpoint: false,
    },
  ],
};

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function waitForOutput(child, regex, label, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
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

// Click the LEAF element whose trimmed text is EXACTLY `text`. Used for catalog
// rows, where a substring match would wrongly hit another tool's description
// (e.g. get_restaurants_for_keyword's description names get_saved_addresses_for_user).
async function clickExactText(page, text, timeoutMs = 15_000) {
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll("*")].some(
        (e) => e.children.length === 0 && e.textContent.trim() === text,
      ),
    { timeout: timeoutMs },
    text,
  );
  const handle = await page.evaluateHandle(
    (text) =>
      [...document.querySelectorAll("*")].find(
        (e) => e.children.length === 0 && e.textContent.trim() === text,
      ) || null,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No leaf element with exact text "${text}"`);
  await el.click();
}

// Click the button whose trimmed text is EXACTLY `text` (avoids "Import JSON"
// matching when we want the modal's "Import").
async function clickExactButton(page, text, timeoutMs = 15_000) {
  await page.waitForFunction(
    (text) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === text),
    { timeout: timeoutMs },
    text,
  );
  const handle = await page.evaluateHandle(
    (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text) || null,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`No button with exact text "${text}"`);
  await el.click();
}

async function setControlValue(page, selector, value) {
  await page.evaluate(
    (selector, value) => {
      const el = document.querySelector(selector);
      const proto = el instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

function preText(page) {
  return page.evaluate(() => [...document.querySelectorAll("pre")].map((p) => p.innerText).join("\n"));
}

async function main() {
  const backend = spawn(tsxBin, ["src/server/index.ts"], {
    cwd: backendDir,
    env: { ...process.env, MCP_WS_PORT: WS_PORT },
    detached: true,
  });
  children.push(backend);
  backend.stderr.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  await waitForOutput(backend, /listening on/, "backend WS server");

  const vite = spawn("npm", ["run", "dev", "--", "--port", UI_PORT, "--strictPort"], {
    cwd: frontendDir,
    env: { ...process.env, VITE_MCP_WS_URL: WS_URL },
    detached: true,
  });
  children.push(vite);
  vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  await waitForOutput(vite, new RegExp(`localhost:${UI_PORT}`), "vite dev server");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let page;
  try {
    page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`[browser console.error] ${m.text()}`);
    });
    await page.goto(`http://localhost:${UI_PORT}`, { waitUntil: "domcontentloaded" });

    // ── 1. Connect with the real config ──────────────────────────────────────
    await clickByText(page, "button", "paste JSON");
    await page.waitForSelector('textarea[aria-label="Paste mcp-config.json"]');
    await setControlValue(page, 'textarea[aria-label="Paste mcp-config.json"]', JSON.stringify(realConfig, null, 2));
    await clickByText(page, "button", "Open Workspace");

    await page.waitForFunction(() => document.body.innerText.includes("Live"), { timeout: 30_000 });
    check("UI1 transport reads Live (browser↔backend WS open)", true);
    await page.waitForFunction(
      () => /airbnb_search/.test(document.body.innerText) && /get_restaurants_for_keyword/.test(document.body.innerText),
      { timeout: 60_000 },
    );
    check("UI2 catalog renders real airbnb + zomato tools", true);

    // ── 2. Run a real zomato tool (no args, authenticated) in Pane 3 ──────────
    await clickExactText(page, "get_saved_addresses_for_user");
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.getAttribute("aria-label") === "Run tool"),
      { timeout: 10_000 },
    );
    await page.click('button[aria-label="Run tool"]');
    await page.waitForFunction(
      () => [...document.querySelectorAll("pre")].map((p) => p.innerText).join("\n").includes("address_id"),
      { timeout: 30_000 },
    );
    check("UI3 zomato get_saved_addresses_for_user → real result rendered", true);

    // ── 3. Run a real airbnb tool — set args via the Raw JSON editor ──────────
    await clickExactText(page, "airbnb_search");
    await clickExactButton(page, "Raw");
    await page.waitForSelector('textarea[aria-label="Raw JSON arguments"]', { timeout: 10_000 });
    await setControlValue(page, 'textarea[aria-label="Raw JSON arguments"]', '{"location":"San Francisco","adults":2}');
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Run tool");
        return b && !b.disabled;
      },
      { timeout: 10_000 },
    );
    await page.click('button[aria-label="Run tool"]');
    await page.waitForFunction(
      () => [...document.querySelectorAll("pre")].map((p) => p.innerText).join("\n").includes("searchResults"),
      { timeout: 45_000 },
    );
    check("UI4 airbnb_search (raw args editor) → real listings rendered", true);

    // ── 4. Import a $ref workflow and run it to completion over WS ────────────
    await clickByText(page, "button", "Import JSON");
    await page.waitForSelector('textarea[aria-label="Workflow JSON"]', { timeout: 10_000 });
    await setControlValue(page, 'textarea[aria-label="Workflow JSON"]', JSON.stringify(importWf, null, 2));
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Import" && !b.disabled),
      { timeout: 10_000 },
    );
    await clickExactButton(page, "Import");
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 2, { timeout: 10_000 });
    check("UI5 workflow imported → 2 nodes on canvas", true);

    await clickByText(page, "button", "Run Workflow");
    // Completed nodes render the unique check-mark path "M2 6l3 3 5-5".
    await page.waitForFunction(
      () => {
        const nodes = [...document.querySelectorAll(".react-flow__node")];
        return nodes.length === 2 && nodes.filter((n) => n.outerHTML.includes("M2 6l3 3 5-5")).length === 2;
      },
      { timeout: 60_000 },
    );
    check("UI6 workflow ran over WS → both nodes completed ($ref resolved live)", true);

    const noError = await page.evaluate(() => !document.body.innerText.includes("run failed"));
    check("UI7 no run-failed banner after workflow", noError);
  } catch (err) {
    check(`harness error: ${err.message}`, false);
    if (page) {
      await page.screenshot({ path: "/tmp/e2e-fail.png", fullPage: true }).catch(() => {});
      const dump = await preText(page).catch(() => "");
      if (dump) console.log("---- visible <pre> at failure ----\n", dump.slice(0, 1200));
      const body = await page.evaluate(() => document.body.innerText).catch(() => "");
      if (body) console.log("---- body innerText (slice) ----\n", body.slice(0, 1500));
    }
    throw err;
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n========  ${results.length - failed.length}/${results.length} browser checks passed  ========`);
  if (failed.length) process.exit(1);
}

main()
  .then(() => {
    cleanup();
    console.log("\nREAL-CONFIG E2E OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nREAL-CONFIG E2E FAILED:", err.message);
    cleanup();
    process.exit(1);
  });
