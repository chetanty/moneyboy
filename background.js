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
You are given only the Experience section of a LinkedIn profile, never the headline.
How to read it:
- CURRENT ROLE is the Experience entry marked "Present". Take the title and company from it.
- In EXPERIENCE, a company with several roles is listed as the company name, then total tenure, then each role. The company line can sit above the CURRENT ROLE title.
- Location: use the location line of the current role (or of its company group). Only if neither lists one, use PROFILE LOCATION. "Remote" is a valid location; assume the company's home country for currency.
- Use the full EXPERIENCE for seniority (years in the field, past titles).
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
  const cacheKey = "c4:" + url; // bumped: older entries may have been read from the headline
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
        parts: [{ text: `CURRENT ROLE (Experience entry marked Present):\n${data.currentRole}\n\n`
          + `EXPERIENCE (most recent first):\n${data.experience}\n\n`
          + `PROFILE LOCATION (fallback only):\n${data.profileLocation || "(not listed)"}` }],
      }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const result = JSON.parse(json);

  await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), result } });
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "estimate") return;
  estimate(msg.url, msg.data)
    .then((result) => sendResponse({ result }))
    .catch((e) => sendResponse({ error: e.message }));
  return true; // async response
});

