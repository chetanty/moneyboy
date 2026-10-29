# Moneyboy

Chrome extension that shows an estimated salary range for the current role on any LinkedIn profile, using Gemini.

## Run it
1. Get a free Gemini API key at https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env` and add your key:
   ```
   GEMINI_API_KEY=your-key-here
   ```
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
4. Open any `linkedin.com/in/...` profile. The estimate appears in a card at the bottom right.

After editing code or `.env`, click the reload icon on Moneyboy in `chrome://extensions`.

Estimates are for the role, not the person's actual pay.
