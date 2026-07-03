// realbrain.js — a REAL LLM running fully inside the browser, no API.
//
// Uses WebLLM (https://github.com/mlc-ai/web-llm): model weights are
// downloaded ONCE from the public CDN, cached by the browser, and inference
// runs locally on the GPU via WebGPU. Nothing is ever sent to any server.

export const BRAIN_MODELS = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 (0.5B) — Fast",
    size: "~350 MB",
    desc: "Best for phones & quick answers",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 (1B) — Smart",
    size: "~880 MB",
    desc: "Meta's Llama brain — better answers, needs a decent device",
  },
];

const SYSTEM_PROMPT =
  "You are Super AI, a helpful assistant running fully inside the user's browser with no external API. " +
  "You are excellent at programming (all languages) and general questions. " +
  "If the user writes in Hindi or Hinglish, reply in the same style (Hinglish). " +
  "Be concise. Use markdown code blocks for code.";

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
  async chat(prompt, onToken) {
    if (!this.engine) throw new Error("Real Brain not loaded yet");
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...this.history.slice(-8),
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
