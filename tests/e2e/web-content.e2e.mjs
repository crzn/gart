// Browser end-to-end test of the quiz editor and branding UI. Starts its own local Worker.
//   node tests/e2e/web-content.e2e.mjs   (requires `npm run build -w @gart/web` first)
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerDir = join(root, "apps", "worker");
const wr = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = 8794, BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const { chromium } = createRequire((process.env.PLAYWRIGHT_ROOT ?? execFileSync("npm", ["root", "-g"]).toString().trim()) + "/")("playwright");

// A 96x96 PNG made on the fly (no binary fixture in the repo).
function makePng() {
  const w = 96, h = 96, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw[o + 1 + x * 3] = x * 2; raw[o + 2 + x * 3] = y * 2; raw[o + 3 + x * 3] = 120; }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const tmp = mkdtempSync(join(tmpdir(), "ql-"));
const pngPath = join(tmp, "logo.png");
writeFileSync(pngPath, makePng());

copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
rmSync(join(workerDir, ".wrangler", "state"), { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
execFileSync(process.execPath, [wr, "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.dev.jsonc"], { cwd: workerDir, env, stdio: "ignore" });
const server = spawn(process.execPath, [wr, "dev", "-c", "wrangler.dev.jsonc", "--port", String(PORT)], { cwd: workerDir, env, stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); }

let bad = 0;
const check = (name, cond) => { console.log(`  ${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) bad++; };
const browser = await chromium.launch();
try {
  const r = await fetch(`${BASE}/api/setup`, { method: "POST", headers: { "content-type": "application/json", "x-gart-csrf": "1" }, body: JSON.stringify({ token: "local-dev-setup-token-0123456789", email: "owner@example.com", displayName: "Olena", password: "Correct-Horse-Battery-9" }) });
  check("owner created", r.status === 201);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "owner@example.com");
  await page.fill("#password", "Correct-Horse-Battery-9");
  await page.click("button[type=submit]");
  await page.waitForSelector("[role=tablist]");
  check("the Quizzes tab is the first one shown", (await page.textContent("body")).includes("Нова вікторина"));

  await page.fill("#qt", "Кібербезпека");
  await page.selectOption("#qtpl", "tpl_cyber");
  const box = await page.textContent("main");
  check("template description is in Ukrainian and lists what it sets", box.includes("Сценарні питання") && box.includes("Що задає цей шаблон") && box.includes("Час на питання: 30 с") && !/Scenario questions/.test(box));
  check("template names in the list are Ukrainian", (await page.locator("#qtpl option").allTextContents()).every((x) => x === "Без шаблону" || /[А-Яа-яІі]/.test(x)));
  const optBg = await page.evaluate(() => getComputedStyle(document.querySelector("#qtpl option")).backgroundColor);
  check("drop-down options have a dark background", optBg === "rgb(30, 41, 59)");
  await page.click("button:has-text('Створити')");
  await page.waitForSelector("#mt");
  check("creating a quiz opens the editor with the template's settings", (await page.inputValue("#s-defaultTimeLimitSec")) === "30");

  let calls = 0;
  const count = (req) => { if (req.url().includes("/api/")) calls++; };
  page.on("request", count);
  await page.waitForTimeout(1500);
  page.off("request", count);
  check("an idle editor does not poll or loop on the API", calls === 0);
  await page.click("button:has-text('Додати питання')");
  await page.fill("#qtext", "Що таке фішинг?");
  const opts = page.locator("input[aria-label^='Варіант']");
  await opts.nth(0).fill("Шахрайське повідомлення");
  await opts.nth(1).fill("Різновид антивіруса");
  await page.click("button:has-text('Додати варіант')");
  await opts.nth(2).fill("Мережевий кабель");
  await page.click("button:has-text('Зберегти питання')");
  await page.waitForSelector("ol li");
  check("question appears in the list", (await page.textContent("ol")).includes("Що таке фішинг?"));

  await page.click("button:has-text('Додати питання')");
  await page.selectOption("#qtype", "truefalse");
  await page.fill("#qtext", "Паролем можна ділитися з колегами?");
  await page.locator("input[type=radio]").nth(1).check();
  await page.click("button:has-text('Зберегти питання')");
  await page.waitForFunction(() => document.querySelectorAll("ol li").length === 2);
  check("true/false question saved", (await page.locator("ol li").count()) === 2);

  await page.click("button[aria-label='Вниз']");
  await page.waitForTimeout(400);
  check("question order can be changed", (await page.locator("ol li").first().textContent()).includes("Паролем"));

  await page.click("button[aria-label='Редагувати']");
  await page.fill("#qtext", "");
  await page.click("button:has-text('Зберегти питання')");
  check("browser validation blocks an empty question text", (await page.locator("#qtext:invalid").count()) === 1);
  await page.click("button:has-text('Скасувати')");

  await page.setInputFiles("input[type=file]", pngPath);
  await page.waitForSelector("img[src^='/api/media/']");
  check("cover image uploaded (compressed in the browser) and shown", (await page.locator("img[src^='/api/media/']").count()) > 0);
  const src = await page.getAttribute("img[src^='/api/media/']", "src");
  const img = await fetch(BASE + src);
  check("stored image is WebP or JPEG, i.e. it was re-encoded", ["image/webp", "image/jpeg"].includes(img.headers.get("content-type")));

  await page.selectOption("select[aria-label='Статус']", "active");
  await page.waitForFunction(() => document.querySelector("select[aria-label='Статус']")?.value === "active");
  check("a valid quiz can be activated", true);

  await page.fill("#mt", "Кібербезпека 2026");
  await page.click("button:has-text('Зберегти')");
  await page.waitForSelector("[role=status]");
  check("details saved", (await page.locator("[role=status]").count()) > 0);
  await page.click("button:has-text('До списку')");
  await page.waitForSelector("text=Кібербезпека 2026");
  check("list shows the new title and question count", (await page.textContent("body")).includes("2 пит."));

  await page.click("button[aria-label='Дублювати']");
  await page.waitForFunction(() => document.querySelectorAll("ul li").length >= 2);
  check("duplicate appears", (await page.textContent("body")).includes("(copy)"));
  await page.click("button[aria-label='Видалити']");
  await page.waitForTimeout(500);
  check("quiz can be deleted", (await page.locator("ul li").count()) === 1);

  await page.click("text=Брендування");
  await page.fill("#bn", "Acme Corp");
  await page.fill("#bw", "Привіт, команда!");
  await page.evaluate(() => { const el = document.querySelector("#c-primaryColor"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "#d90429"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("button:has-text('Зберегти')");
  await page.waitForSelector("[role=status]");
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
  check("saved colour is applied live", brand === "#d90429");
  check("company name appears in the header", (await page.textContent("header")).includes("Acme Corp"));
  await page.reload();
  await page.waitForSelector("header");
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() === "#d90429");
  check("branding survives a reload", true);
  check("no uncaught page errors", errors.length === 0);
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmp, "web-content.png"), fullPage: true });
  console.log("screenshot:", join(process.env.SHOT_DIR ?? tmp, "web-content.png"));
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
  try { execFileSync("pkill", ["-f", "workerd"]); } catch { /* none */ }
  copyFileSync(join(workerDir, ".dev.vars.example"), join(workerDir, ".dev.vars"));
}
process.exit(bad ? 1 : 0);
