# Super AI — by codian_studio

A polished AI coding & answering product. It writes real code in any language,
answers everyday questions, remembers you, and can run private on-device
intelligence — **or** grow a knowledge base 24×7 on your own cPanel server.

Three ways to run it, mix and match:

| | Runs where | What you get |
|---|---|---|
| **Browser app** (`index.html` + `assets/`) | 100% client-side (GitHub Pages or any static host) | code generation, memory, on-device intelligence (Codian Neo), daily credits |
| **cPanel backend** (`backend/`) | your PHP + MySQL hosting | real login, **24×7 server-side learning**, realtime web scraping, optional hosted LLM |
| **Python app** (`server.py` + `superai/`) | any machine with Python 3 | the original stdlib server version |

➡️ **Deploying on cPanel? Read [HOSTING.md](HOSTING.md)** — it covers the
database, the 24×7 cron learner, Google login, and plugging in a powerful
hosted LLM, plus how to train/improve it later.

## 🌐 Deploy on GitHub Pages (no server needed)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**.
3. Pick your branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
4. Open `https://<user>.github.io/<repo>/` and sign in.

Everything (chats, memory, credits) is saved in the browser, so it survives
refreshes. A `.nojekyll` file is included so Pages serves `assets/` untouched.

## ✨ What it does

- **Models** — five options in the sidebar for different tasks: Codian Coder
  (flagship coding engine), Codian Core (everyday conversation), Codian Neo
  (private on-device intelligence), Codian Swift (instant, low-cost answers),
  Codian Sage (deep multi-source reasoning).
- **Writes real, runnable code** in Python, JavaScript, Java, C++, HTML and
  more — Telegram bots, REST APIs, games, algorithms, utilities — with a
  visible reasoning trace before the answer.
- **Codian Neo** — activate it in the sidebar for private, on-device
  intelligence. Prepares once, then runs fully locally; nothing leaves the
  device.
- **Understands Hindi/Hinglish** as naturally as English.
- **Remembers you** — your name and preferences carry across sessions.
- **Chats & history** — a New Chat button starts a fresh conversation; every
  past conversation is saved and can be reopened from the sidebar.
- **Daily credits** per user, with a live balance and reset countdown.
- **Real sign-in** — name + email, guest, or Google (once configured).
- **Mobile-safe** — background work never runs while the tab is hidden, so it
  never freezes the browser.

## ⚡ Python version (optional, for a local server)

```bash
python3 server.py            # open http://localhost:8000
python3 server.py --port 9000
python3 server.py --limit 50000
```

No `pip install`, no API keys, no config.

## 🧪 Tests

```bash
node tests/core.test.mjs
```

## 📁 Files

**Browser app:**
- `index.html` — the app UI
- `assets/js/app.js` — UI wiring
- `assets/js/brain.js` — response engine & model routing
- `assets/js/codegen.js` — code generation, math, small talk
- `assets/js/realbrain.js` — on-device intelligence (Codian Neo)
- `assets/js/auth.js` — sign-in
- `assets/js/backend.js` — optional bridge to the cPanel backend
- `assets/js/swarm.js` — knowledge export/import & peer sync
- `assets/js/store.js` — browser persistence
- `config.js` — site configuration
- `tests/core.test.mjs` — test suite

**cPanel backend** (see [HOSTING.md](HOSTING.md) for full setup):
- `backend/schema.sql` — database schema
- `backend/api/*.php` — auth, chat, realtime answers, knowledge search
- `backend/cron/learn.php` — the 24×7 background learner

**Python app:**
- `server.py`, `superai/*.py`, `static/index.html`
