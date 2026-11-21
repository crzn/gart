import { CloudflareClient, CloudflareError, DeployError, deploy, sanitizeCompanyName, isHexColor, verifyPackage, workersDevUrl } from "@gart/deploy-engine";
import { TEXT } from "./i18n.js";

const CFG = /** @type {{ key: JsonWebKey, repo: string }} */ (/** @type {any} */ (window).GART);
const client = (token) => new CloudflareClient({ base: "/cf", token });

const S = {
  lang: localStorage.getItem("gart.installer.lang") ?? (navigator.language?.startsWith("uk") ? "uk" : "en"),
  screen: "welcome", busy: false, error: null,
  token: "", accounts: [], accountId: "", subdomain: null, subdomainDraft: "",
  zones: [], zonesOk: false,
  form: { company: "", color: "#4f46e5", adminName: "", adminEmail: "", worker: "gart", db: "gart-db", zoneId: "", host: "" },
  pkg: null, manifest: null, run: { steps: {}, failed: null }, result: null, health: "waiting", healthVersion: "",
};
const t = () => TEXT[S.lang];
const $ = (sel) => document.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const go = (screen) => { S.screen = screen; S.error = null; if (screen === "run") S.run = { steps: {}, failed: null, started: false }; render(); window.scrollTo(0, 0); };
const errBox = () => (S.error ? h("div", { class: "err", role: "alert" }, S.error) : "");

function explain(e) {
  const x = t();
  if (e instanceof CloudflareError) {
    if (e.status === 401) return x.tokenBad;
    if (e.status === 403 || e.code === 10000) return x.permMissing;
    if (e.status === 0) return x.network;
    return e.message;
  }
  if (e instanceof DeployError && /already exists/.test(e.message)) return x.existsErr;
  return e.message ?? String(e);
}

const STEP_INDEX = { welcome: 0, token: 1, account: 2, settings: 3, run: 4, done: 5 };
function chrome(body) {
  const x = t();
  return h("div", {},
    h("header", {}, h("h1", {}, "Gart · " + x.title),
      h("div", { class: "lang", role: "group", "aria-label": x.lang },
        ["uk", "en"].map((l) => h("button", { type: "button", "aria-pressed": String(S.lang === l), onClick: () => { S.lang = l; localStorage.setItem("gart.installer.lang", l); render(); } }, l.toUpperCase())))),
    h("main", {},
      h("ol", { class: "steps" }, x.steps.map((s, i) => h("li", { class: i === STEP_INDEX[S.screen] ? "on" : i < STEP_INDEX[S.screen] ? "done" : "" }, s))),
      body));
}

/* ------------------------------ screens ------------------------------ */
function viewWelcome() {
  const x = t();
  return h("section", { class: "card" }, h("h2", {}, x.welcomeH), h("p", {}, x.welcomeP), h("p", {}, h("b", {}, x.need)),
    h("ul", {}, [x.need1, x.need2, x.need3].map((s) => h("li", {}, s))), h("p", { class: "note" }, x.privacy),
    h("div", { class: "row" }, h("button", { class: "primary", id: "start", onClick: () => go("token") }, x.start)));
}

function viewToken() {
  const x = t();
  const input = h("input", { id: "token", type: "password", autocomplete: "off", spellcheck: "false", value: S.token });
  const btn = h("button", { class: "primary", id: "check", disabled: S.busy, onClick: async () => {
    S.token = input.value.trim();
    if (!S.token) return;
    S.busy = true; S.error = null; render();
    try {
      const c = client(S.token);
      S.accounts = await c.listAccounts();
      if (S.accounts.length === 0) throw new Error(x.tokenNoAccount);
      S.accountId = S.accounts[0].id;
      S.busy = false;
      go("account");
    } catch (e) { S.busy = false; S.error = e instanceof CloudflareError && [400, 401, 403].includes(e.status) ? x.tokenBad : explain(e); render(); }
  } }, S.busy ? x.checking : x.check);
  return h("section", { class: "card" }, h("h2", {}, x.tokenH), h("p", {}, x.tokenHow),
    h("ol", {}, x.tokenSteps.map((s) => h("li", {}, s))),
    h("label", { for: "token" }, x.tokenLabel), input, errBox(),
    h("div", { class: "row" }, h("button", { class: "ghost", onClick: () => go("welcome") }, x.back), btn));
}

function viewAccount() {
  const x = t();
  const select = h("select", { id: "account", onChange: (e) => { S.accountId = e.target.value; S.subdomain = null; } },
    S.accounts.map((a) => h("option", { value: a.id, selected: a.id === S.accountId }, `${a.name} (${a.id.slice(0, 6)}…)`)));
  const sub = h("input", { id: "subdomain", value: S.subdomainDraft, placeholder: "my-company" });
  const proceed = async (needSub) => {
    S.busy = true; S.error = null; render();
    try {
      const c = client(S.token);
      S.subdomain = await c.getWorkersSubdomain(S.accountId);
      if (!S.subdomain && needSub) {
        const name = sub.value.trim().toLowerCase();
        S.subdomainDraft = name;
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new Error(x.subdomainBad);
        if (!(await c.subdomainAvailable(S.accountId, name))) throw new Error(x.subdomainTaken);
        S.subdomain = await c.registerWorkersSubdomain(S.accountId, name);
      }
      if (!S.subdomain) { S.busy = false; S.needSubdomain = true; render(); return; }
      try { S.zones = await c.listZones(S.accountId); S.zonesOk = S.zones.length > 0; } catch { S.zones = []; S.zonesOk = false; }
      S.busy = false; S.needSubdomain = false;
      go("settings");
    } catch (e) { S.busy = false; S.error = explain(e); render(); }
  };
  return h("section", { class: "card" }, h("h2", {}, x.accountH), h("p", {}, x.accountPick), select,
    S.needSubdomain ? [h("h2", {}, x.subdomainH), h("p", {}, x.subdomainP), h("label", { for: "subdomain" }, x.subdomainLabel), sub] : "",
    errBox(),
    h("div", { class: "row" }, h("button", { class: "ghost", onClick: () => go("token") }, x.back),
      h("button", { class: "primary", id: "account-next", disabled: S.busy, onClick: () => proceed(S.needSubdomain) }, S.needSubdomain ? x.register : x.next)));
}

const NAME_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
function viewSettings() {
  const x = t(), f = S.form;
  const field = (id, label, props = {}, hint) => [h("label", { for: id }, label), h("input", { id, value: f[props.key ?? id] ?? "", ...props, onInput: (e) => { f[props.key ?? id] = e.target.value; } }), hint ? h("div", { class: "hint" }, hint) : ""];
  const zoneSel = h("select", { id: "zone", onChange: (e) => { f.zoneId = e.target.value; render(); } },
    h("option", { value: "" }, x.domainNone), S.zones.map((z) => h("option", { value: z.id, selected: z.id === f.zoneId }, z.name)));
  const submit = () => {
    const name = f.worker.trim(), db = f.db.trim();
    if (!NAME_RE.test(name) || !NAME_RE.test(db)) { S.error = x.errName; return render(); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.adminEmail.trim())) { S.error = x.errEmail; return render(); }
    if (f.company && sanitizeCompanyName(f.company) === null) { S.error = x.errCompany; return render(); }
    if (!isHexColor(f.color)) { S.error = x.errCompany; return render(); }
    if (f.zoneId) {
      const zone = S.zones.find((z) => z.id === f.zoneId);
      const host = f.host.trim().toLowerCase();
      if (!zone || !(host === zone.name || host.endsWith("." + zone.name))) { S.error = x.errHost; return render(); }
    }
    go("run");
  };
  return h("section", { class: "card" }, h("h2", {}, x.settingsH),
    field("company", x.company, { maxlength: 60 }, x.companyHint),
    h("label", { for: "color" }, x.color), h("input", { id: "color", type: "color", value: f.color, onInput: (e) => { f.color = e.target.value; } }),
    field("adminName", x.adminName, { autocomplete: "name" }),
    field("adminEmail", x.adminEmail, { type: "email", autocomplete: "email" }, x.adminHint),
    h("details", {}, h("summary", {}, x.advanced),
      field("worker", x.workerName), field("db", x.dbName),
      h("label", { for: "zone" }, x.domainLabel), S.zonesOk ? zoneSel : h("p", { class: "hint" }, x.domainNoZones),
      S.zonesOk && f.zoneId ? field("host", x.domainHost, { placeholder: "quiz." + (S.zones.find((z) => z.id === f.zoneId)?.name ?? "") }) : ""),
    errBox(),
    h("div", { class: "row" }, h("button", { class: "ghost", onClick: () => go("account") }, x.back), h("button", { class: "primary", id: "install", onClick: submit }, x.install)));
}

function viewRun() {
  const x = t();
  const ids = ["database", "migrations", "assets", "worker", "address", "domain", "branding"];
  const label = (id) => { const st = S.run.steps[id]; return st ? x[st] ?? st : x.waiting; };
  return h("section", { class: "card" }, h("h2", {}, x.runH),
    S.manifest ? h("p", { class: "ok", id: "pkg-ok" }, `${x.pkgOk} ${S.manifest.version}`) : h("p", {}, x.loadingPkg),
    ids.map((id) => h("div", { class: "check", "data-step": id }, h("span", {}, x.stepNames[id]), h("span", { class: S.run.steps[id] === "done" ? "ok" : S.run.steps[id] === "failed" ? "bad" : "" }, label(id)))),
    errBox(),
    S.run.failed ? h("div", { class: "row" }, h("button", { class: "ghost", onClick: () => go("settings") }, x.back), h("button", { class: "primary", id: "retry", onClick: () => startRun() }, x.retry)) : "");
}

function viewDone() {
  const x = t(), r = S.result;
  const link = `${r.url}/setup#${new URLSearchParams({ token: r.setupToken, email: S.form.adminEmail.trim(), name: S.form.adminName.trim() })}`;
  return h("section", { class: "card" }, h("h2", {}, x.doneH), h("p", {}, x.doneP),
    h("p", {}, `${x.yourSite}: `, h("a", { href: r.url, target: "_blank", rel: "noopener" }, r.url)),
    h("p", { id: "health", class: S.health === "up" ? "ok" : "warn" }, S.health === "up" ? `${x.siteUp} ${S.healthVersion}` : S.health === "slow" ? x.siteSlow : x.waitingSite),
    h("div", { class: "row" }, h("a", { class: "primary linkbtn", id: "owner-link", href: link }, x.createOwner)),
    h("h2", { class: "mt" }, x.cleanupH), h("p", {}, x.cleanupP));
}

/* ------------------------------ install ------------------------------ */
async function startRun() {
  const x = t();
  S.error = null; S.run = { steps: {}, failed: null, started: true };
  render();
  try {
    if (!S.pkg) {
      const res = await fetch("/pkg");
      if (!res.ok) throw new Error(`${x.packageErr} (${res.status})`);
      const pkg = await res.json();
      try { S.manifest = await verifyPackage(pkg, CFG.key); } catch (e) { throw new Error(`${x.packageErr} ${e.message}`); }
      S.pkg = pkg;
      render();
    }
    const f = S.form;
    const hostname = f.zoneId && f.host.trim() ? f.host.trim().toLowerCase() : null;
    const result = await deploy({
      client: client(S.token), accountId: S.accountId, pkg: S.pkg, manifest: S.manifest, workerName: f.worker.trim(), databaseName: f.db.trim(), mode: "install", hostname,
      ...(f.company.trim() ? { companyName: f.company.trim() } : {}), primaryColor: f.color,
      onProgress: (p) => { S.run.steps[p.step] = p.status; render(); },
    });
    S.result = { url: hostname ? `https://${hostname}` : workersDevUrl(f.worker.trim(), S.subdomain), setupToken: result.setupToken, version: result.version };
    try { sessionStorage.setItem("gart.setup", JSON.stringify(S.result)); } catch { /* optional */ }
    S.health = "waiting";
    go("done");
    pollHealth();
  } catch (e) {
    S.run.failed = true; S.error = explain(e); render();
  }
}

async function pollHealth() {
  for (let i = 0; i < 24 && S.screen === "done"; i++) {
    try {
      const r = await fetch(`${S.result.url}/api/health`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); S.health = "up"; S.healthVersion = j.version ?? ""; render(); return; }
    } catch { /* not reachable yet */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (S.screen === "done" && S.health !== "up") { S.health = "slow"; render(); }
}

function render() {
  const views = { welcome: viewWelcome, token: viewToken, account: viewAccount, settings: viewSettings, run: viewRun, done: viewDone };
  const root = $("#app");
  document.documentElement.lang = S.lang;
  const focusId = document.activeElement?.id;
  root.replaceChildren(chrome(views[S.screen]()));
  if (focusId && S.screen !== "run") $("#" + focusId)?.focus?.();
  if (S.screen === "run" && !S.run.started) { S.run.started = true; startRun(); }
}
render();
