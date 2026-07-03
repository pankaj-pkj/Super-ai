# 🧠 Super AI — Self-Training Mind

A **fully self-contained AI website**. No OpenAI, no external AI API, no dependencies —
pure Python stdlib. The mind trains itself, harvests knowledge from GitHub and the web,
learns from every conversation, and keeps making itself more powerful forever.

## ⚡ Quick start

```bash
python3 server.py
# open http://localhost:8000
```

That's it. No `pip install`, no API keys, no config.

Options:

```bash
python3 server.py --port 9000            # custom port
python3 server.py --limit 50000          # daily token limit per user
python3 server.py --harvest-interval 300 # self-learning every 5 min
python3 server.py --no-harvest           # disable autonomous learning
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

- `server.py` — web server + API
- `superai/brain.py` — the mind: retrieval, markov, model routing
- `superai/trainer.py` — LlamaLite neural model (pure-Python backprop)
- `superai/harvester.py` — autonomous self-learning loop
- `superai/tokens.py` — daily token limits
- `superai/state.py` — SQLite persistence
- `static/index.html` — the full UI
- `ai.py` — legacy Freedom AI REPL (original prototype)
