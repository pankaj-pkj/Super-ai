// realbrain.js — a REAL LLM running fully inside the browser, no API.
//
// Uses WebLLM (https://github.com/mlc-ai/web-llm): model weights are
// downloaded ONCE from the public CDN, cached by the browser, and inference
// runs locally on the GPU via WebGPU. Nothing is ever sent to any server.

// Public premium names hide the underlying open models.
export const BRAIN_MODELS = [
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    label: "Neo Lite",
    size: "~270 MB",
    desc: "Lightest — works on most phones",
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Neo Fast",
    size: "~350 MB",
    desc: "Great balance for phones & quick answers",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Neo Standard",
    size: "~880 MB",
    desc: "Noticeably better answers",
  },
  {
    id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    label: "Neo Coder — best for coding",
    size: "~1.4 GB",
    desc: "Purpose-built for code — Telegram bots, APIs, full programs",
    coder: true,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Neo Pro",
    size: "~1.6 GB",
    desc: "Strong all-round — good laptops/PCs",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Neo Max",
    size: "~2.3 GB",
    desc: "Best quality — needs a PC with a real GPU",
  },
];

const SYSTEM_PROMPT =
  "You are Super AI, created by team codian_studio. You run fully inside the user's browser with no external API. " +
  "If asked who you are or who made you, say you are Super AI made by team codian_studio — vary your wording naturally, " +
  "and never mention any other company, base model, or training provider. " +
  "You are a senior software architect: for complex coding or system-design tasks, first reason step by step inside " +
  "<thinking>...</thinking> tags (plan, edge cases, syntax check), then give the final answer. " +
  "Never output placeholder code or tell the user to insert their own logic — every snippet must be complete and runnable. " +
  "If the user writes in Hindi or Hinglish, reply in Hinglish. Be concise. Use markdown code blocks for code.";

export class RealBrain {
  constructor() {
    this.engine = null;
    this.modelId = null;
    this.loading = false;
    this.progressText = "";
    this.history = []; // rolling chat history
  }

  supported() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  get ready() {
    return this.engine !== null;
  }

  async load(modelId, onProgress) {
    if (this.engine && this.modelId === modelId) return;
    if (this.loading) throw new Error("already loading");
    if (!this.supported())
      throw new Error("WebGPU not available in this browser. Use a recent Chrome/Edge (desktop or Android) or Safari 26+.");
    this.loading = true;
    try {
      const webllm = await import("https://esm.run/@mlc-ai/web-llm");
      this.engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (r) => {
          this.progressText = r.text || "";
          if (onProgress) onProgress(r);
        },
      });
      this.modelId = modelId;
      this.history = [];
    } finally {
      this.loading = false;
    }
  }

  // Streams the reply; onToken receives the accumulated text so far.
  // `history` (optional [{role,content}]) overrides internal memory so context
  // survives page reloads and matches the visible conversation.
  async chat(prompt, onToken, history = null) {
    if (!this.engine) throw new Error("Real Brain not loaded yet");
    let sys = SYSTEM_PROMPT;
    if (this.userName) sys += ` The user's name is ${this.userName}.`;
    const prior = (history && history.length) ? history.slice(-8) : this.history.slice(-8);
    const messages = [
      { role: "system", content: sys },
      ...prior,
      { role: "user", content: prompt },
    ];
    const stream = await this.engine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 600,
      stream: true,
    });
    let out = "";
    for await (const chunk of stream) {
      out += chunk.choices?.[0]?.delta?.content || "";
      if (onToken) onToken(out);
    }
    this.history.push({ role: "user", content: prompt });
    this.history.push({ role: "assistant", content: out });
    this.history = this.history.slice(-12);
    return out;
  }

  stats() {
    return {
      ready: this.ready,
      loading: this.loading,
      model: this.modelId,
      progress: this.progressText,
      supported: this.supported(),
    };
  }
}
