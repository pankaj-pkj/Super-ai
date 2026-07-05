# 🧠 Super AI — Self-Training Mind by Panku.

A **fully self-contained AI**. No OpenAI, no external AI API, no build step, no
dependencies. The mind trains itself, harvests knowledge from GitHub and the web,
learns from every conversation, and keeps making itself more powerful forever.

It ships in **two forms** from the same repo:

| | Runs where | Persistence | Backend |
|---|---|---|---|
| **Browser app** (`index.html` + `assets/`) | 100% in the browser — perfect for **GitHub Pages** | IndexedDB | none |
| **Python app** (`server.py` + `superai/`) | any machine with Python 3 | SQLite | stdlib HTTP server |

## 🌐 Deploy free on GitHub Pages (no server, no VPS)

The browser app needs zero backend — ideal while you don't have a VPS yet.

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**.
3. Pick your branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
4. Open `https://<user>.github.io/<repo>/` — Super AI boots, seeds its
   built-in knowledge, and starts learning 24×7 in your browser.

Everything (knowledge, neural weights, token usage) is saved in the browser's
IndexedDB, so it survives refreshes and keeps growing each visit. A `.nojekyll`
file is included so Pages serves the `assets/` folder untouched.

### 🧩 Real Brain — an actual LLM in your browser (no API!)
Pick **Real Brain** in the sidebar: it downloads a real model **once** from
the public MLC/WebLLM CDN, caches it in the browser, and runs it locally on
your GPU via WebGPU. Nothing ever leaves your device — no API key, no server.
Six models to choose from:

| Model | Size | Best for |
|---|---|---|
| SmolLM2 360M | ~270 MB | any phone |
| Qwen 2.5 0.5B | ~350 MB | quick answers |
| **Meta Llama 3.2 1B** | ~880 MB | better answers |
| **Qwen 2.5 Coder 1.5B** | ~1.4 GB | **coding — Telegram bots, APIs, full programs** |
| Qwen 2.5 1.5B | ~1.6 GB | strong all-round |
| Llama 3.2 3B | ~2.3 GB | best quality (PC) |

Once a Real Brain is loaded, **every text model** (Super Chat, Super Sage,
Super Coder…) uses it — so they all get a real brain. After the first load
it's cached and can auto-load on desktop. Streaming replies, remembers the
conversation, writes code in any language, understands Hindi. Needs a recent
Chrome/Edge (desktop or Android) or Safari 26+.

### 📱 Mobile-safe (no more freezing)
Heavy neural work never runs while the tab is in the background, pauses the
instant you switch away, yields to the UI every few milliseconds, and runs a
lighter/slower schedule on phones. Big model auto-download is **off by default
and never triggers on mobile** — that was the old freeze cause. Measured main-
thread stall during code generation: **~39 ms (smooth)**.

### 💬 Chats & history
A **New Chat** button starts a fresh conversation; every conversation is saved
and listed in the sidebar — tap any one to reload it. Nothing is lost on
refresh.

### ✍️ It actually writes code now
A built-in code generator handles real requests — e.g.
*"Write a Python function called find_duplicates that returns duplicate
strings with their counts"* produces exactly that function, working, with the
name you asked for. 20 templates × Python/JavaScript/HTML (fibonacci,
palindrome, primes, sorting, binary search, email validation, calculator,
todo app, login page, fetch API, …), plus safe **math evaluation**
("56*89 kitna hoga?" → 4984) and small talk — **in English and
Hindi/Hinglish** ("palindrome check karne ka code banao" works).

### 🔐 Login
A polished sign-in screen (name + email, or guest). Each user gets their own
daily token budget and their conversations/memory follow them. **Google
Sign-In** activates automatically when you put an OAuth Client ID in
`config.js` (pure client-side Google Identity Services — no backend needed).

### 🌐 Swarm Intelligence & Immutable Knowledge Portability
The entire trained mind — documents, **embedding vectors** (192-dim local
embeddings of every sentence), strategy weights and **LoRA-style neural delta
patches** (trained − reproducible seeded base) — exports to one standalone,
model-agnostic **`knowledge_swarm_delta.json`** bundle. Inject it into any
Super AI (or a future engine) to inherit 100% of the intelligence.
Two browsers can also pair **directly over WebRTC data channels with no
server** — signaling travels as copy-paste codes — and their minds sync both
ways automatically: User B's AI immediately knows what User A's AI learned.

### 🧠 Reasoning engine
Code answers come with a collapsible **Reasoning** trace (task → language →
plan → edge cases → verification), and the Real Brain is instructed to think
step-by-step in `<thinking>` blocks before answering complex tasks.

### What runs in the browser
- **~45 built-in knowledge entries** across 20+ languages, so it answers real
  code questions immediately (Python, JavaScript, TypeScript, Java, C, C++, C#,
  Go, Rust, Ruby, PHP, Swift, Kotlin, SQL, HTML, CSS, Bash, R, plus DSA, Git,
  REST, ML concepts).
- **LlamaLite** neural model (RMSNorm + SiLU, char-level) training from scratch
  in pure JS with manual backprop — chunked so the UI never freezes.
- **24×7 harvester**: while the tab is open it scrapes GitHub (top repos per
  language) and Wikipedia (CORS-friendly), resolves a curiosity queue of things
  users asked but it didn't know, and retrains the neural model.
- **Daily token limits** per user with a 5-model registry, each model a
  different token cost.
- **English + Hindi** UI (🌐 toggle).

## ⚡ Python version (optional, for a real server)

```bash
python3 server.py            # open http://localhost:8000
python3 server.py --port 9000
python3 server.py --limit 50000          # daily token limit per user
python3 server.py --harvest-interval 300 # self-learning every 5 min
python3 server.py --no-harvest           # disable autonomous learning
```

No `pip install`, no API keys, no config.

## 🧪 Tests

```bash
node tests/core.test.mjs     # browser-AI core (retrieval, neural, tokens, feedback)
```

## ✨ Features

### 🎛 Daily token limits
Every user gets a daily token budget (default **20,000 tokens/day**, resets at
midnight UTC). Live token meter in the UI with a countdown to reset. When the
budget runs out, chat is blocked with a clear banner until reset.

### 🔀 Task-specific models (each with its own token price)
| Model | Task | Cost |
|---|---|---|
| ⚡ Super Mini | Fast replies, quick facts | 1× |
| 💬 Super Chat | General conversation | 2× |
| 🦙 Super Llama | Raw neural generation from the self-trained model | 3× |
| 👨‍💻 Super Coder | Code help — learns from GitHub | 4× |
| 🧠 Super Sage | Deep research, multi-source synthesis | 6× |

Switch models in the sidebar — pricing, tier and task are shown on each card.

### 🦙 LlamaLite — its own neural model, trained from scratch
A Llama-style micro language model (**RMSNorm + SiLU**, char-level) implemented in
pure Python with manual backpropagation. No torch, no numpy. It trains on
everything the mind has learned, checkpoints to SQLite, and its live loss curve
is shown in the sidebar. Trigger training manually or let auto-training run.

### 🔁 Self-improvement loop (it makes itself more powerful)
A background harvester runs forever:
1. **GitHub harvesting** — scrapes GitHub trending, learns READMEs and code of top repos
2. **Curiosity queue** — anything a user asked that the mind didn't know gets
   auto-researched from the web and learned
3. **Neural retraining** — LlamaLite retrains on the grown corpus
4. Every step is logged to the live **Self-Improvement Feed** in the UI

### 👤 Learns from users
- Every conversation is ingested into the knowledge base
- 👍/👎 feedback retunes the generation strategy weights in real time

### 📚 Teach it anything
Paste any URL (article, docs, GitHub README, raw code file) into
**Teach from URL** — it reads, indexes and retrains instantly.

## 🧬 How the mind works

```
                ┌──────────────────────────────┐
                │        static/index.html     │  ← premium dark UI
                └──────────────┬───────────────┘
                               │ JSON API
┌──────────────────────────────┴────────────────────────────────┐
│  server.py  (stdlib ThreadingHTTPServer)                      │
│  /api/chat /api/models /api/tokens /api/stats /api/learn      │
│  /api/train /api/feedback /api/harvest /api/evolution         │
└───────┬───────────────┬───────────────┬───────────────────────┘
        │               │               │
  ┌─────▼─────┐   ┌─────▼──────┐  ┌─────▼──────┐
  │ TokenBank │   │ SuperBrain │  │ Harvester  │  ← autonomous loop
  │ daily     │   │ TF-IDF +   │  │ GitHub +   │
  │ limits    │   │ Markov +   │  │ curiosity +│
  └───────────┘   │ LlamaLite  │  │ retraining │
                  └─────┬──────┘  └────────────┘
                  ┌─────▼──────────────────────┐
                  │ SuperState (SQLite)        │  ← permanent memory
                  │ docs·sentences·chats·usage │
                  └────────────────────────────┘
```

## 📡 API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | `{message, model, user}` → response + tokens charged |
| `/api/models` | GET | model registry with pricing |
| `/api/tokens?user=` | GET | daily balance + reset countdown |
| `/api/stats` | GET | brain + neural + harvester stats |
| `/api/learn` | POST | `{url}` → learn a page/file now |
| `/api/train` | POST | `{steps}` → train LlamaLite |
| `/api/feedback` | POST | `{chat_id, good}` → adapt strategy |
| `/api/harvest` | POST | trigger a self-improvement cycle now |
| `/api/evolution` | GET | live self-improvement feed |

## 📁 Files

**Browser app (GitHub Pages):**
- `index.html` — the full UI (entry point for Pages)
- `assets/js/core.js` — vocab, tokenizer, helpers
- `assets/js/store.js` — IndexedDB persistence (+ in-memory store for tests)
- `assets/js/llamalite.js` — LlamaLite neural model in pure JS (manual backprop)
- `assets/js/knowledge.js` — built-in multi-language knowledge base + i18n
- `assets/js/brain.js` — the mind: retrieval, markov, model routing
- `assets/js/harvester.js` — 24×7 in-browser self-learning loop
- `assets/js/tokens.js` — daily token limits
- `assets/js/app.js` — UI wiring
- `tests/core.test.mjs` — Node test suite

**Python app (optional server):**
- `server.py` — web server + API
- `superai/*.py` — brain, LlamaLite trainer, harvester, tokens, SQLite state
- `static/index.html` — server UI
- `ai.py` — legacy Freedom AI REPL (original prototype)
