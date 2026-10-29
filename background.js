const MODEL = "gemini-3.5-flash-lite"; // ~1s per estimate
const CACHE_DAYS = 14;

// Extensions can't see real env vars, so the key lives in a .env file inside the extension folder.
async function getKey() {
  try {
    const env = await (await fetch(chrome.runtime.getURL(".env"))).text();
    const m = env.match(/^\s*GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]*)/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const SYSTEM = `You estimate market compensation for a job role.
Given raw text scraped from a LinkedIn profile, identify the CURRENT title, company and location, then estimate
How to read the text:
- TOP CARD is name, then headline, then usually a "City, Region, Country" line near "Contact info", plus the current company/school.
- People often forget to update their headline. If a CURRENT ROLE block is given, it is the truth: take title and company from it even if the headline says something else.
- Otherwise prefer the first EXPERIENCE entry (the one with "Present" in its dates) over the headline. Only fall back to the headline when there is no Experience.
- In EXPERIENCE, a company with several roles is listed as the company name, then total tenure, then each role. Use the top role.
- Location: use the current role's location if it has one, otherwise the top card location.
Then estimate typical annual pay for that role at that company and location using your knowledge of public salary data (Levels.fyi, Glassdoor, government wage surveys, pay transparency postings).
Use the local currency of the location (CAD for Canada, USD for US, etc).
Respond with ONLY a JSON object, no prose:
{"title": str, "company": str, "location": str, "currency": "ISO code",
 "base_low": number, "base_mid": number, "base_high": number,
 "total_comp_mid": number or null,
 "confidence": "low" | "medium" | "high",
 "basis": "one short sentence on what the estimate rests on"}
If the person is a student, unemployed, or the role can't be determined, still return the JSON with confidence "low" and explain in basis.`;

async function estimate(url, data) {
  const cacheKey = "c3:" + url; // bumped: older entries could hold the previous profile's numbers
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached && Date.now() - cached.at < CACHE_DAYS * 864e5) return cached.result;

  const apiKey = await getKey();
  if (!apiKey) {
    throw new Error("No Gemini API key. Copy .env.example to .env in the extension folder, add your key, then reload Moneyboy in chrome://extensions.");
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: "user",
        parts: [{ text: (data.currentRole ? `CURRENT ROLE (Experience entry marked Present):\n${data.currentRole}\n\n` : "")
          + `TOP CARD:\n${data.topCard}\n\nEXPERIENCE (most recent first):\n${data.experience || "(not loaded yet)"}` }],
      }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const result = JSON.parse(json);

  // headline-only guesses get refined once Experience loads, so don't let them stick
  if (data.experience) await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), result } });
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "estimate") return;
  estimate(msg.url, msg.data)
    .then((result) => sendResponse({ result }))
    .catch((e) => sendResponse({ error: e.message }));
  return true; // async response
});

