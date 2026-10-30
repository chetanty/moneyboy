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

// LinkedIn renders every label twice (visible + screen-reader copy). Depending on the
// layout the copies land on separate lines or glued together ("ExperienceExperience").
function undouble(l) {
  const half = l.length / 2;
  return Number.isInteger(half) && l.slice(0, half) === l.slice(half) ? l.slice(0, half) : l;
}

function linesOf(root) {
  const lines = [];
  for (const raw of (root?.innerText || "").split("\n")) {
    const l = undouble(raw.trim());
    if (l && l !== lines[lines.length - 1]) lines.push(l);
  }
  return lines;
}

// Prefer <main>, but some layouts render profile sections outside it
function pageLines() {
  const main = linesOf(document.querySelector("main"));
  if (main.includes("Experience")) return main;
  const body = linesOf(document.body);
  if (body.includes("Experience")) return body;
  // last resort: LinkedIn has long tagged the section with an #experience anchor
  const section = document.getElementById("experience")?.closest("section");
  if (section) {
    const lines = linesOf(section);
    if (!lines.includes("Experience")) lines.unshift("Experience");
    return [...(main.length ? main : body), ...lines.slice(lines.indexOf("Experience"))];
  }
  return main.length ? main : body;
}

// Shape of the page (no profile text beyond short labels), for when Experience can't be found
function debugInfo() {
  const box = scroller();
  const short = (s) => s.trim().split("\n")[0].slice(0, 60);
  return JSON.stringify({
    url: location.pathname.replace(/\/in\/[^/]+/, "/in/…"),
    hasMain: !!document.querySelector("main"),
    hasExperienceAnchor: !!document.getElementById("experience"),
    scroller: box === (document.scrollingElement || document.documentElement) ? "window" : `${box.tagName}.${String(box.className).slice(0, 40)}`,
    scroll: [box.scrollTop, box.clientHeight, box.scrollHeight],
    nameFound: !!profileName(),
    scrollableInMain: [...document.querySelectorAll("main, main *")].filter((el) => /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 50).map((el) => `${el.tagName}.${String(el.className).slice(0, 30)} ${el.clientHeight}/${el.scrollHeight}`).slice(0, 5),
    scrollableAncestorsOfMain: (() => { const out = []; for (let el = document.querySelector("main"); el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 50) out.push(`${el.tagName}.${String(el.className).slice(0, 30)} ${getComputedStyle(el).overflowY} ${el.clientHeight}/${el.scrollHeight}`); return out; })(),
    h2: [...document.querySelectorAll("h2")].map((h) => short(h.innerText)).slice(0, 20),
    linesMentioningExperience: (document.body.innerText || "").split("\n").filter((l) => /experience/i.test(l)).map(short).slice(0, 10),
  }, null, 1);
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

// The tab title is "Name | LinkedIn" (sometimes with a "(3) " unread count in front) on every
// layout, unlike the heading tag, which is an h1 in some layouts and an h2 in others.
function profileName() {
  const fromTitle = document.title.replace(/^\(\d+\+?\)\s*/, "").split(" | ")[0].trim();
  if (fromTitle && fromTitle !== "LinkedIn") return fromTitle;
  return text(document.querySelector("main h1") || document.querySelector("h1"));
}

function scrapeProfile() {
  const name = profileName();
  const lines = pageLines();
  if (!lines.length) return null;

  const experience = experienceFromLines(lines);

  if (!name && !lines.length) return null;
  return {
    name,
    experience: experience.slice(0, 2500),
    currentRole: currentRole(experience),
    profileLocation: profileLocation(lines, name),
  };
}

// The headline is ignored entirely. The only thing taken from the top card is the
// city line just above "Contact info", used when the current role doesn't list a location.
function profileLocation(lines, name) {
  const start = Math.max(0, lines.indexOf(name));
  const contact = lines.indexOf("Contact info", start);
  return contact > start ? lines[contact - 1].replace(/\s*·\s*$/, "") : "";
}

// Lines under the "Experience" heading, only if they look like real entries (a year or "Present"),
// so an empty placeholder or a stray nav link isn't mistaken for the section.
function experienceFromLines(lines) {
  const i = lines.indexOf("Experience");
  if (i < 0) return "";
  const exp = sliceUntilHeading(lines, i + 1, 40);
  return /\b(19|20)\d{2}\b|\bPresent\b/.test(exp) ? exp : "";
}

// Text nodes as lines, for documents that were parsed but never rendered (innerText needs layout).
function textNodeLines(root) {
  const lines = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest("script, style, code, template, noscript")) continue;
    const l = undouble(n.textContent.trim());
    if (l && l !== lines[lines.length - 1]) lines.push(l);
  }
  return lines;
}

// Way 1: download the person's dedicated Experience page and read it without rendering it.
// Works only if LinkedIn puts the entries in the HTML rather than filling them in with JS.
async function fetchExperience(url) {
  try {
    const res = await fetch(url + "/details/experience/", { credentials: "include" });
    if (!res.ok) return "";
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return experienceFromLines(textNodeLines(doc.body));
  } catch {
    return "";
  }
}

// Way 2: load that page in an invisible frame so LinkedIn's own JS renders it, then read it.
// The frame covers the viewport at opacity 0 because lazy sections only load when "on screen".
async function frameExperience(url) {
  const f = document.createElement("iframe");
  f.src = url + "/details/experience/";
  f.tabIndex = -1;
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;opacity:0;pointer-events:none;z-index:-1;border:0";
  document.body.appendChild(f);
  try {
    let prev = "";
    for (let i = 0; i < 40; i++) { // up to 10s
      await sleep(250);
      if (url !== lastUrl) return "";
      let doc;
      try {
        doc = f.contentDocument;
      } catch {
        return ""; // LinkedIn refused to be framed
      }
      if (!doc?.body || doc.location.href === "about:blank") continue;
      const exp = experienceFromLines(linesOf(doc.querySelector("main") || doc.body));
      if (exp && exp === prev) return exp; // same two polls in a row: finished rendering
      prev = exp;
    }
    return prev;
  } finally {
    f.remove();
  }
}

// People often leave their headline stale, so pull out the Experience entry marked "Present".
// The few lines around it carry the title, company (for grouped roles it sits above) and location.
function currentRole(experience) {
  const lines = experience.split("\n");
  const i = lines.findIndex((l) => /\bPresent\b/i.test(l));
  return i < 0 ? "" : lines.slice(Math.max(0, i - 4), i + 3).join("\n");
}

// The element that actually scrolls the profile. Newer LinkedIn layouts scroll an inner
// panel, not the window (the window is exactly one screen tall), so moving the window does nothing.
function scroller() {
  const scrolls = (el) => /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 50;
  // walk up from the profile's own headings (the name is an h2 in some layouts, not an h1)
  const starts = [...document.querySelectorAll("main h1, main h2"), document.querySelector("main")].filter(Boolean);
  for (const start of starts) {
    for (let el = start; el && el !== document.documentElement; el = el.parentElement) {
      if (scrolls(el)) return el;
    }
  }
  return document.scrollingElement || document.documentElement;
}

// Experience is lazy-loaded when it scrolls into view. Jump down a screen at a time until it
// shows up, then put the user back where they were, so nobody has to scroll to it by hand.
async function loadExperience() {
  const box = scroller();
  if (box.scrollHeight > box.clientHeight + 50) {
    const y = box.scrollTop;
    try {
      for (let i = 1; i <= 10; i++) {
        box.scrollTop = y + box.clientHeight * i;
        await sleep(100);
        if (scrapeProfile()?.experience) return;
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break; // reached the bottom
      }
    } finally {
      box.scrollTop = y;
    }
  }
  if (!scrapeProfile()?.experience) await revealByHeading();
}

// Fallback when we can't tell what scrolls: ask the browser to bring the last loaded profile
// section into view (it scrolls whatever containers it needs to), repeat as new sections load,
// then restore every scroll position it touched.
async function revealByHeading() {
  const saved = new Map();
  const remember = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (!saved.has(a)) saved.set(a, a.scrollTop);
    const root = document.scrollingElement || document.documentElement;
    if (!saved.has(root)) saved.set(root, root.scrollTop);
  };
  try {
    for (let i = 0; i < 10; i++) {
      const headings = [...document.querySelectorAll("main h2")].filter((h) => HEADINGS.has(undouble(h.innerText.trim().split("\n")[0])));
      const last = headings[headings.length - 1];
      if (!last) return;
      remember(last);
      last.scrollIntoView({ block: "start", behavior: "instant" });
      await sleep(150);
      if (scrapeProfile()?.experience) return;
    }
  } finally {
    for (const [el, top] of saved) el.scrollTop = top;
  }
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
  if (state.info) {
    el.innerHTML = `<div class="sp-head">Moneyboy <button class="sp-x">×</button></div><div class="sp-muted">${esc(state.info)}</div>`
      + (state.debug ? `<button class="sp-debug">Copy debug info</button>` : "");
    el.querySelector(".sp-x").onclick = () => el.remove();
    const btn = el.querySelector(".sp-debug");
    if (btn) btn.onclick = async () => {
      try { await navigator.clipboard.writeText(debugInfo()); btn.textContent = "Copied, paste it to Claude"; }
      catch { console.log("[Moneyboy debug]", debugInfo()); btn.textContent = "Couldn't copy; it's in the console (F12)"; }
    };
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
    <div class="sp-foot">Market estimate for the role, not this person's actual pay.${state.via ? ` Experience read via ${esc(state.via)}.` : ""}</div>`;
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
      render({ result: res.result, via: data.via });
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

  // Experience can render on its own shortly after the top card; give it a second
  for (let i = 0; i < 4 && !data.experience; i++) {
    await sleep(250);
    if (stale()) return;
    data = scrapeProfile() || data;
  }

  // still lazy: read the Experience page in the background, first by fetching it, then via a hidden frame
  let via = data.experience ? "page" : "";
  for (const [how, get] of [["background fetch", fetchExperience], ["hidden frame", frameExperience]]) {
    if (data.experience) break;
    const exp = await get(url);
    if (stale()) return;
    if (exp) {
      data = { ...data, experience: exp.slice(0, 2500), currentRole: currentRole(exp) };
      via = how;
    }
  }

  // last resort: scroll the page ourselves, then give the content a few seconds to arrive
  if (!data.experience) {
    via = "auto-scroll";
    await loadExperience();
    for (let i = 0; i < 16 && !data.experience; i++) {
      if (stale()) return;
      data = scrapeProfile() || data;
      if (!data.experience) await sleep(250);
    }
  }

  // Experience is the only source. If the nudge didn't load it, keep checking for a while.
  if (!data.experience) {
    via = "manual scroll";
    render({ info: "Waiting for the Experience section. Scroll down to it if it hasn't loaded.", debug: true });
    for (let i = 0; i < 120 && !data.experience; i++) {
      await sleep(1000);
      if (stale() || !alive()) return;
      data = scrapeProfile() || data;
    }
    if (!data.experience) return render({ info: "No Experience section on this profile, so no estimate.", debug: true });
  }

  // nothing marked "Present" means they aren't currently in a role
  if (!data.currentRole) return render({ info: "Not currently working: no role in Experience is marked Present." });

  render({ loading: true });
  requestEstimate(url, { ...data, via });
}

const observer = new MutationObserver(() => run());
observer.observe(document, { subtree: true, childList: true });
run();
