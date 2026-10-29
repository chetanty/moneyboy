<p align="center">
  <img src="icons/icon128.png" width="96" alt="Moneyboy icon">
</p>

<h1 align="center">Moneyboy</h1>

<p align="center">See an estimated salary range for anyone's current role while you browse LinkedIn.</p>

---

Open a LinkedIn profile and Moneyboy shows a small card in the corner with the typical base pay range, total comp, and how confident the estimate is. It reads the person's current title, company and location from the page and asks Gemini for a market estimate, usually in about a second.

## Features
- **Works on any profile:** reads the top card and Experience section, so it uses the actual current role rather than a catchy headline
- **Local currency:** CAD for Canada, USD for the US, and so on
- **Confidence + reasoning:** every estimate says how sure it is and what it's based on
- **Fast and cheap:** uses `gemini-3.5-flash-lite` and caches each profile for 14 days

## Setup
1. Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Copy `.env.example` to `.env` and add your key:
   ```
   GEMINI_API_KEY=your-key-here
   ```
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
4. Visit any `linkedin.com/in/...` profile.

After changing code or `.env`, hit the reload icon on Moneyboy in `chrome://extensions`.

## How it works
| File | Role |
|---|---|
| `content.js` | Reads the profile's visible text, splits it into top card and Experience, shows the card |
| `background.js` | Sends that text to Gemini, parses the JSON estimate, caches it |
| `.env` | Your API key (git-ignored, read by the extension from its own folder) |

## Notes
- Numbers are a **market estimate for the role**, not the person's actual salary.
- Keep `.env` out of anything you share; it contains your key.
- If LinkedIn changes its layout and the card stops appearing, start with `scrapeProfile()` in `content.js`.
