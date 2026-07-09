# Deploying Super AI — cPanel + GPU (full guide)

Read this once and the whole picture clicks.

## The mental model: TWO boxes

Super AI has a **body** (the code you have) and a **brain** (a model). They live
on two different machines because they need different things:

```
   ┌──────────────────────────┐        ┌──────────────────────────────┐
   │  BOX A — cPanel           │        │  BOX B — GPU server           │
   │  (cheap, always on)       │  HTTPS │  (rented/owned, has a GPU)     │
   │  • the website (frontend) │ ─────► │  • Python engine + Hub        │
   │  • PHP backend + MySQL    │        │  • the model (GLM/Qwen/Llama) │
   │  NO GPU here              │        │  downloaded ONCE, served to all│
   └──────────────────────────┘        └──────────────────────────────┘
```

**Why two?** cPanel shared/cloud hosting has **no GPU**, so it can't run a big
model. It's perfect for the website though. The GPU box runs the brain and the
Hub; the website just talks to it over HTTPS. Every user shares that ONE brain —
no per-browser download, no weak models.

> If your "cPanel" is actually a VPS/dedicated server **with a GPU**, then A and B
> are the same box — skip the split and run both there.

---

## Do you need to TRAIN it? No.

- The model's intelligence is **already trained** by its makers. You only
  **download** it once (a few GB) onto the GPU box — automatic on first run.
- The **self-improvement** (soul evolution, dream self-review, learning from
  chats) happens **automatically at runtime**. There is no manual training step,
  ever.
- This download is on the **server**, not in each browser (unlike the old
  in-browser Codian Neo). One download → everyone benefits.

---

## PART 1 — The GPU box (the brain)

### 1a. Get a GPU
Cheapest start is to **rent** (pay per hour, no upfront):

| Provider | Example | Rough cost |
|---|---|---|
| RunPod / Vast.ai | RTX 4090 (24GB) | ~$0.3–0.7 /hr |
| Lambda / Paperspace | A10 / A100 | ~$0.5–1.5 /hr |

Buy later if it pays off: RTX 3090 (24GB, used ~$700) or 4090 (24GB).

**VRAM guide** (pick a model that fits):

| Model | fp16 VRAM | 4-bit VRAM | Good GPU |
|---|---|---|---|
| Qwen2.5-Coder-7B | ~16 GB | ~6 GB | any 12GB+ (4-bit) |
| GLM-4-9B | ~20 GB | ~7 GB | 24GB, or 12GB in 4-bit |
| Qwen2.5-Coder-32B | ~65 GB | ~20 GB | 24GB in 4-bit |

Start with **coder-7b** or **glm-9b** on a 24GB card.

### 1b. Install + run
```bash
# on the GPU box (Ubuntu)
sudo apt update && sudo apt install -y python3-pip git
git clone https://github.com/pankaj-pkj/Super-ai.git
cd Super-ai
pip install -r engine/requirements.txt
pip install torch transformers accelerate            # the local brain
pip install bitsandbytes                             # optional: 4-bit (less VRAM)

# run the Hub — the model auto-downloads ONCE on first start (a few GB)
SUPERAI_HUB_MODEL=coder-7b uvicorn engine.hub:app --host 0.0.0.0 --port 8000
#            ^ or glm-9b, coder-32b, llama-8b
```
First start pulls the weights from Hugging Face and caches them (subsequent
starts are instant). `GET http://<gpu-box-ip>:8000/health` should show your model.

To use 4-bit on a smaller GPU, set it in code (or ask me to add a
`SUPERAI_HUB_4BIT=1` switch):
```python
TwoModelSystem(llm=local_brain("coder-7b", load_in_4bit=True))
```

### 1c. Keep it running + HTTPS
```bash
# run as a service so it survives reboots
sudo tee /etc/systemd/system/superai.service >/dev/null <<'EOF'
[Unit]
Description=Super AI Hub
After=network.target
[Service]
WorkingDirectory=/root/Super-ai
Environment=SUPERAI_HUB_MODEL=coder-7b
ExecStart=/usr/bin/uvicorn engine.hub:app --host 0.0.0.0 --port 8000
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now superai
```
Put HTTPS in front (so the website can call it): easiest is Cloudflare Tunnel
(`cloudflared`) or Caddy/Nginx with a domain → gives you
`https://brain.yourdomain.com`.

---

## PART 2 — The cPanel box (the website)

Your website is already built. Deploy it and point it at the brain.

1. **Upload the site** to `public_html` (Git Version Control clone, or upload —
   see the earlier steps / HOSTING.md).
2. **Point the frontend at the Hub.** In `config.js` set ONE line:
   ```js
   window.SUPERAI_CONFIG = {
     HUB_URL: "https://brain.yourdomain.com",   // your GPU Hub from Part 1c
     ...
   };
   ```
   That's it — the frontend is already wired. On load it health-checks the Hub;
   if reachable, every visitor's chat **streams from that one shared brain**
   (a "☁ Cloud Brain connected" toast confirms it). If the Hub is down it falls
   back to the on-device brain automatically — nothing breaks.
3. **Optional PHP backend + 24×7 learner** (accounts, server-side crawl): follow
   `HOSTING.md` (database, `backend/config.php`, cron job).

---

## PART 3 — Which brain runs where (summary)

| Where user is | Brain used | Download? |
|---|---|---|
| Website + GPU Hub live | the ONE server model (GLM/Qwen) | once, on the GPU box |
| No GPU box yet | in-browser Codian Neo (WebLLM) | once, per browser (fallback) |
| Dev / no model | Offline provider (deterministic) | none |

You can ship today with the in-browser fallback, then flip on the GPU Hub when
your card is ready — the frontend supports both.

---

## Cost-smart path
1. **Now:** website on cPanel + in-browser Codian Neo → $0 extra, works.
2. **When ready:** rent a 4090 by the hour, run the Hub with `coder-7b`, point
   the site at it → everyone gets the powerful shared brain.
3. **If it grows:** buy a GPU or a bigger model (`coder-32b`), change one env var.

No retraining at any step — your knowledge/soul carry over.
