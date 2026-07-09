"""Local, in-process LLM brain — ZERO API, runs on YOUR GPU.

`LocalHFProvider` loads open-weight model files directly with Hugging Face
Transformers and generates in-process. Nothing is sent anywhere: no API key,
no external server, no network. This is the "powerful brain without an API"
path — buy/rent a GPU, download a model once, and the whole engine runs on it.

Heavy deps (torch/transformers) are imported lazily so the rest of the engine
still runs and tests without them. After you have a GPU:

    pip install torch transformers accelerate
    # optional 4-bit (less VRAM): pip install bitsandbytes

Recommended open models (all run locally, no API):
    Qwen/Qwen2.5-Coder-7B-Instruct     coding, ~16GB fp16 / ~6GB 4-bit
    Qwen/Qwen2.5-Coder-32B-Instruct    strong coding, 24GB+ / 4-bit
    zai-org/GLM-4-9B-0414              GLM locally on one GPU  ← your "real mind"
    meta-llama/Llama-3.1-8B-Instruct   general
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import AsyncIterator, List, Optional

from .config import ModelConfig
from .models import LLMResponse, Message, ModelRole


class LocalDepsMissing(RuntimeError):
    pass


class LocalHFProvider:
    """In-process Transformers inference. name != 'offline' so it counts as online."""

    name = "local_hf"

    def __init__(
        self,
        model_id: str = "Qwen/Qwen2.5-Coder-7B-Instruct",
        device_map: str = "auto",
        dtype: str = "auto",
        load_in_4bit: bool = False,
        trust_remote_code: bool = True,
    ):
        self.model_id = model_id
        self.device_map = device_map
        self.dtype = dtype
        self.load_in_4bit = load_in_4bit
        self.trust_remote_code = trust_remote_code
        self._model = None
        self._tok = None
        self._load_lock = threading.Lock()

    # ------------------------------------------------------------- loading
    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            try:
                import torch  # noqa: F401
                from transformers import AutoModelForCausalLM, AutoTokenizer
            except ImportError as e:  # pragma: no cover - depends on host GPU setup
                raise LocalDepsMissing(
                    "Local brain needs torch + transformers. After you get a GPU:\n"
                    "  pip install torch transformers accelerate"
                ) from e

            kwargs = {"device_map": self.device_map, "trust_remote_code": self.trust_remote_code}
            if self.dtype != "auto":
                kwargs["torch_dtype"] = self.dtype
            else:
                kwargs["torch_dtype"] = "auto"
            if self.load_in_4bit:
                from transformers import BitsAndBytesConfig
                kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True)

            self._tok = AutoTokenizer.from_pretrained(
                self.model_id, trust_remote_code=self.trust_remote_code
            )
            self._model = AutoModelForCausalLM.from_pretrained(self.model_id, **kwargs)

    def _build_inputs(self, messages: List[Message]):
        text = self._tok.apply_chat_template(
            [m.to_api() for m in messages], tokenize=False, add_generation_prompt=True
        )
        return self._tok(text, return_tensors="pt").to(self._model.device)

    # ------------------------------------------------------------- complete
    def _generate_sync(self, messages: List[Message], mc: ModelConfig) -> str:
        self._ensure_loaded()
        import torch

        inputs = self._build_inputs(messages)
        with torch.no_grad():
            out = self._model.generate(
                **inputs,
                max_new_tokens=mc.max_tokens,
                temperature=max(mc.temperature, 1e-4),
                top_p=mc.top_p,
                do_sample=mc.temperature > 0,
                pad_token_id=self._tok.eos_token_id,
            )
        new_tokens = out[0][inputs["input_ids"].shape[1]:]
        return self._tok.decode(new_tokens, skip_special_tokens=True).strip()

    async def complete(self, messages: List[Message], mc: ModelConfig) -> LLMResponse:
        t0 = time.time()
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, self._generate_sync, messages, mc)
        return LLMResponse(
            text=text, model=f"local:{self.model_id}", role_used=ModelRole.CHAT,
            prompt_tokens=sum(len(m.content) // 4 for m in messages),
            completion_tokens=len(text) // 4,
            latency_ms=int((time.time() - t0) * 1000), provider=self.name,
        )

    # --------------------------------------------------------------- stream
    async def stream(self, messages: List[Message], mc: ModelConfig) -> AsyncIterator[str]:
        self._ensure_loaded()
        from transformers import TextIteratorStreamer

        streamer = TextIteratorStreamer(self._tok, skip_prompt=True, skip_special_tokens=True)
        inputs = self._build_inputs(messages)

        def _run():
            import torch
            with torch.no_grad():
                self._model.generate(
                    **inputs, streamer=streamer, max_new_tokens=mc.max_tokens,
                    temperature=max(mc.temperature, 1e-4), top_p=mc.top_p,
                    do_sample=mc.temperature > 0, pad_token_id=self._tok.eos_token_id,
                )

        threading.Thread(target=_run, daemon=True).start()
        loop = asyncio.get_running_loop()
        it = iter(streamer)
        while True:
            chunk = await loop.run_in_executor(None, lambda: next(it, None))
            if chunk is None:
                break
            if chunk:
                yield chunk
