# Super AI on your cPanel hosting — full guide

This answers: **what your hosting can do**, **how to deploy**, and **how to
train / improve the AI in future**. Written for cPanel Cloud hosting.

---

## 0. The honest big picture (read this first)

There are two "brains" and it helps to know what each needs:

| Brain | Runs where | Needs | Power |
|---|---|---|---|
| **Knowledge brain** (retrieval + your data) | your cPanel server (PHP + MySQL) | nothing special | grows forever, 24×7 |
| **Codian Neo** (a real LLM) | the visitor's device (browser, WebGPU) | a modern phone/PC | good, private, free |
| **Hosted LLM** (optional, most powerful) | an external API you plug in | a free/paid API key | ChatGPT-class |

**Important truth:** a frontier "ChatGPT-level" model needs big GPUs. Shared/Cloud
cPanel has **no GPU**, so you cannot *host* a 70B model on it directly. But you
have three great options, and cPanel powers all of them:

1. **Free & private:** the browser runs Codian Neo (Qwen/Llama) locally.
2. **Most powerful:** plug a **free-tier hosted LLM** (e.g. Groq's free Llama
   3.3 70B) into `backend/config.php`. Then cPanel does retrieval + serves it.
3. **Always-on learning:** cPanel cron grows a knowledge base 24×7 — even when
   nobody has the site open. This is the thing only a server can do.

So the plan below gives you a real product: polished frontend + cPanel backend
that learns around the clock, with an optional one-line upgrade to a top LLM.

---

## 1. What you can do with cPanel hosting

- **Host the whole site** (the frontend) on your domain — no GitHub Pages needed.
- **Real accounts** — server-verified Google & email login (`backend/api/auth.php`).
- **24×7 background learning** — a **cron job** runs `backend/cron/learn.php`
  every few minutes, scraping GitHub + the web into MySQL. Works with the site
  closed. *(This is your "seekhta rahe bina browser ke".)*
- **Realtime answers** — the server scrapes live pages (`backend/api/scrape.php`,
  `realtime.php`) with no browser CORS limits.
- **Central knowledge** — every user benefits from what the server learned.
- **Optional powerful LLM** — one config line to route answers through a hosted model.

---

## 2. Deploy — step by step

### 2a. Upload files
In cPanel **File Manager**, upload the repo into `public_html` so you have:
```
public_html/
├── index.html          ← the app
├── config.js           ← frontend settings
├── assets/…            ← app code
└── backend/            ← the PHP server
    ├── api/…  cron/…  schema.sql  config.sample.php
```

### 2b. Create the database
cPanel → **MySQL® Databases**:
1. Create a database (e.g. `superai`) → you get `youruser_superai`.
2. Create a user, set a password, **Add user to database** with All Privileges.
3. cPanel → **phpMyAdmin** → pick the DB → **Import** → upload
   `backend/schema.sql` → Go.

### 2c. Configure the backend
Copy `backend/config.sample.php` to `backend/config.php` (File Manager → Copy),
then **Edit** and fill in:
```php
'db_name' => 'youruser_superai',
'db_user' => 'youruser_superai',
'db_pass' => 'the password you set',
'allowed_origins' => ['https://yourdomain.com'],
```

### 2d. Point the frontend at the backend
Edit `config.js`:
```js
BACKEND_URL: "https://yourdomain.com/backend",
GOOGLE_CLIENT_ID: "",   // see section 4 for Google login
```

### 2e. Turn on 24×7 learning (the important one)
cPanel → **Cron Jobs** → Common Settings: *Every 5 minutes* → Command:
```
/usr/local/bin/php /home/YOURUSER/public_html/backend/cron/learn.php >/dev/null 2>&1
```
(Find the exact PHP path in cPanel → "Select PHP Version" or use `php`.)
Now the AI learns around the clock. Check progress in phpMyAdmin → `knowledge`.

Done. Visit `https://yourdomain.com`.

---

## 3. Make it genuinely powerful (optional, recommended)

Plug in a **free hosted LLM**. Groq gives a generous free tier with Llama 3.3 70B:
1. Get a free key at <https://console.groq.com/keys>.
2. In `backend/config.php`:
```php
'llm_api_url' => 'https://api.groq.com/openai/v1/chat/completions',
'llm_api_key' => 'gsk_your_key',
'llm_model'   => 'llama-3.3-70b-versatile',
```
Now `backend/api/chat.php` answers with a 70B model **plus** your own knowledge
base as context (RAG). This is the closest to "ChatGPT-level" you can get without
your own GPUs. (Other OpenAI-compatible providers work too — Together, Fireworks,
OpenRouter, DeepInfra; just change the three values.)

The identity stays **Super AI by codian_studio** — the system prompt forbids the
model from naming any provider.

---

## 4. Real Google login
1. <https://console.cloud.google.com/apis/credentials> → Create Credentials →
   OAuth client ID → **Web application**.
2. **Authorized JavaScript origins:** `https://yourdomain.com`.
3. Copy the Client ID into **both** `config.js` (`GOOGLE_CLIENT_ID`) and
   `backend/config.php` (`google_client_id`).
The "Sign in with Google" button appears automatically and is verified
server-side in `auth.php`.

---

## 5. How to train / improve it later — your options

You never need to retrain from scratch. Pick what fits:

1. **It trains itself (default).** The cron learner adds GitHub + web knowledge
   every 5 minutes, forever. Do nothing.
2. **Feed it your own data.** Put your docs/code into the `knowledge` table
   (phpMyAdmin → Insert, or a small script), or add URLs to the crawl list in
   `backend/cron/learn.php` (`$refs`). It learns them on the next run.
3. **Teach specific topics.** Insert rows into the `curiosity` table; the learner
   researches and resolves them automatically.
4. **Upgrade the brain.** Swap `llm_model` for a stronger hosted model — instant
   capability jump, zero retraining.
5. **Portable knowledge bundle.** The app can export everything it learned as one
   JSON file and import it into any future version — knowledge is never lost.

### Adding your own crawl sources
Edit `backend/cron/learn.php` and extend the arrays:
```php
$langs = ['python','javascript', /* add languages */ ];
$refs  = [ 'https://raw.githubusercontent.com/you/your-repo/main/README.md', /* … */ ];
```

---

## 6. Security checklist
- `backend/config.php` holds secrets and is **git-ignored** — never commit it.
- `backend/.htaccess` blocks direct access to config/lib/cron.
- Set `allowed_origins` to your real domain (not `*`) once live.
- Use a cPanel **subdomain with SSL** (AutoSSL) so everything is HTTPS.

---

## 7. FAQ

**Q: Site closed rahe to bhi seekhega?** Yes — that's the cron job (section 2e).
It runs on the server on a schedule, independent of any browser.

**Q: cPanel pe bada LLM chalega?** Not directly (no GPU). Use the free hosted-LLM
option (section 3) — cPanel orchestrates it. That's the standard, correct
architecture.

**Q: GitHub se sikhega?** Yes — the cron learner pulls top repos per language and
their READMEs/code into your knowledge base.

**Q: Realtime sawaal ka data kahan se?** `backend/api/realtime.php` searches the
web (Wikipedia out of the box; add a search API for full coverage) server-side
and caches it.

**Q: Future me naya/better model?** Change one line (`llm_model`) — no retraining,
your knowledge base carries over.
