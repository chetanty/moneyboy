// Runs on linkedin.com. LinkedIn is a single-page app, so we watch for URL changes.
let lastUrl = "";

function isProfile(url) {
  return /linkedin\.com\/in\/[^/]+\/?($|\?)/.test(url);
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
  };
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
    <div class="sp-foot">Market estimate for the role, not this person's actual pay.</div>`;
  el.querySelector(".sp-x").onclick = () => el.remove();
}

async function run() {
  const url = location.href.split("?")[0];
  if (url === lastUrl) return;
  lastUrl = url;

  const old = document.getElementById("moneyboy-card");
  if (!isProfile(url)) { if (old) old.remove(); return; }

  // wait for the profile to render; Experience loads after the top card, so give it a few more seconds
  let data = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (url !== lastUrl) return;
    data = scrapeProfile() || data;
    if (data && (data.experience || i >= 12)) break;
  }
  if (!data || url !== lastUrl) return; // user navigated away while we waited

  render({ loading: true });
  chrome.runtime.sendMessage({ type: "estimate", url, data }, (res) => {
    if (url !== lastUrl) return; // stale response for a previous profile
    if (chrome.runtime.lastError) return render({ error: chrome.runtime.lastError.message });
    if (!res || res.error) return render({ error: res ? res.error : "No response" });
    render({ result: res.result });
  });
}

new MutationObserver(() => run()).observe(document, { subtree: true, childList: true });
run();
