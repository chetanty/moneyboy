// Runs on linkedin.com. LinkedIn is a single-page app, so we watch for URL changes.
let lastUrl = "";
let lastName = ""; // name on the last profile we read, to tell when LinkedIn has swapped in the next one
let reqId = 0; // only the newest estimate request may draw the card

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reloading the extension orphans the copy of this script already running in open tabs:
// chrome.runtime disappears and every call throws "Extension context invalidated".
function alive() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function orphaned() {
  observer.disconnect();
  reqId++;
  if (document.getElementById("moneyboy-card")) render({ error: "Moneyboy was updated. Refresh this page." });
}

function profileUrl() {
  return location.href.split(/[?#]/)[0].replace(/\/$/, "");
}

function isProfile(url) {
  return /linkedin\.com\/in\/[^/]+$/.test(url);
}

function text(el) {
  return el ? el.innerText.replace(/\s+\n/g, "\n").trim() : "";
}

// Section headings on a profile. We slice the page's visible text between these
// instead of relying on LinkedIn's markup, which changes often.
const HEADINGS = new Set([
  "About", "Activity", "Featured", "Highlights", "Analytics", "Resources", "Services",
  "Experience", "Education", "Licenses & certifications", "Skills", "Volunteering",
  "Projects", "Publications", "Courses", "Honors & awards", "Languages",
  "Recommendations", "Interests", "Organizations", "Causes", "Patents", "Test scores",
]);

function pageLines() {
  const root = document.querySelector("main") || document.body;
  const lines = [];
  for (const raw of root.innerText.split("\n")) {
    const l = raw.trim();
    // LinkedIn repeats every label for screen readers; drop the adjacent duplicates
    if (l && l !== lines[lines.length - 1]) lines.push(l);
  }
  return lines;
}

// Lines after `start` up to the next section heading.
function sliceUntilHeading(lines, start, max) {
  const out = [];
  for (let i = start; i < lines.length && out.length < max; i++) {
    if (i > start && HEADINGS.has(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function scrapeProfile() {
  const name = text(document.querySelector("main h1") || document.querySelector("h1"));
  const lines = pageLines();
  if (!lines.length) return null;

  // top card: from the name down to the first section heading (headline, location, current company)
  let start = name ? lines.indexOf(name) : -1;
  if (start < 0) start = 0;
  const topCard = sliceUntilHeading(lines, start, 25);

  const expStart = lines.indexOf("Experience");
  const experience = expStart >= 0 ? sliceUntilHeading(lines, expStart + 1, 40) : "";

  if (!name && !topCard) return null;
  return {
    name,
    topCard: topCard.slice(0, 1500),
    experience: experience.slice(0, 2500),
    currentRole: currentRole(experience),
  };
}

// People often leave their headline stale, so pull out the Experience entry marked "Present".
// The few lines around it carry the title, company (for grouped roles it sits above) and location.
function currentRole(experience) {
  const lines = experience.split("\n");
  const i = lines.findIndex((l) => /\bPresent\b/i.test(l));
  return i < 0 ? "" : lines.slice(Math.max(0, i - 4), i + 3).join("\n");
}

function card() {
  let el = document.getElementById("moneyboy-card");
  if (!el) {
    el = document.createElement("div");
    el.id = "moneyboy-card";
    document.body.appendChild(el);
  }
  return el;
}

// Model output is derived from user-written profile text, so never trust it as HTML.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmt(n, cur) {
  if (typeof n !== "number" || !isFinite(n)) return "?";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString()} ${cur || ""}`;
  }
}

function render(state) {
  const el = card();
  if (state.loading) {
    el.innerHTML = `<div class="sp-head">Moneyboy</div><div class="sp-muted">Estimating…</div>`;
    return;
  }
  if (state.error) {
    el.innerHTML = `<div class="sp-head">Moneyboy <button class="sp-x">×</button></div><div class="sp-err">${esc(state.error)}</div>`;
    el.querySelector(".sp-x").onclick = () => el.remove();
    return;
  }
  const r = state.result;
  el.innerHTML = `
    <div class="sp-head">Moneyboy <button class="sp-x">×</button></div>
    <div class="sp-role">${esc(r.title || "Unknown role")}${r.company ? " @ " + esc(r.company) : ""}</div>
    <div class="sp-mid">${esc(fmt(r.base_mid, r.currency))}</div>
    <div class="sp-range">Base: ${esc(fmt(r.base_low, r.currency))} to ${esc(fmt(r.base_high, r.currency))}</div>
    ${r.total_comp_mid ? `<div class="sp-range">Total comp ~${esc(fmt(r.total_comp_mid, r.currency))}</div>` : ""}
    <div class="sp-muted">${esc(r.location)} · confidence: ${esc(r.confidence)}</div>
    <div class="sp-basis">${esc(r.basis)}</div>
    ${state.partial ? `<div class="sp-muted">Based on the headline only. Scroll down to Experience and it will refine.</div>` : ""}
    <div class="sp-foot">Market estimate for the role, not this person's actual pay.</div>`;
  el.querySelector(".sp-x").onclick = () => el.remove();
}

function requestEstimate(url, data) {
  if (!alive()) return orphaned();
  const id = ++reqId;
  try {
    chrome.runtime.sendMessage({ type: "estimate", url, data }, (res) => {
      if (id !== reqId || url !== lastUrl) return; // superseded by a newer request or another profile
      if (chrome.runtime.lastError) return render({ error: chrome.runtime.lastError.message });
      if (!res || res.error) return render({ error: res ? res.error : "No response" });
      render({ result: res.result, partial: !data.experience });
    });
  } catch {
    orphaned();
  }
}

async function run() {
  if (!alive()) return orphaned();
  const url = profileUrl();
  if (url === lastUrl) return;
  lastUrl = url;
  reqId++; // drop any in-flight answer for the previous profile
  const stale = () => url !== lastUrl;

  if (!isProfile(url)) { document.getElementById("moneyboy-card")?.remove(); return; }
  render({ loading: true }); // clear the previous person's numbers immediately

  // LinkedIn changes the URL before it renders the new profile, so wait for the name to change
  const prevName = lastName;
  let data = null;
  for (let i = 0; i < 16 && !data; i++) { // up to 4s
    await sleep(250);
    if (stale()) return;
    const d = scrapeProfile();
    if (d && d.name && d.name !== prevName) data = d;
  }
  if (!data) data = scrapeProfile(); // same name as before, or the page is slow: take what's there
  if (!data) return;
  lastName = data.name;

  // Experience renders after the top card; give it a few more seconds
  for (let i = 0; i < 16 && !data.experience; i++) {
    await sleep(250);
    if (stale()) return;
    data = scrapeProfile() || data;
  }

  requestEstimate(url, data);
  if (data.experience) return;

  // Experience is lazy-loaded on scroll. When it shows up, re-estimate from the real current role.
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    if (stale() || !alive()) return;
    const d = scrapeProfile();
    if (d && d.experience) return requestEstimate(url, d);
  }
}

const observer = new MutationObserver(() => run());
observer.observe(document, { subtree: true, childList: true });
run();
