"""Super AI Engine — autonomous, self-improving AI software-engineer backend.

A modular FastAPI/asyncio core by codian_studio. Built to run on cloud (cPanel)
and portable environments (Termux/proot-distro).

Modules
-------
1. two_model  — dual-model routing (Chat + Tool-Maker) + SoulManager
2. tasks      — task/agent state machine (pending/running/completed/failed) [next]
3. sync       — FlushGate + SerialBatchEventUploader (WebSocket/SSE) [next]
4. memory     — microcompactMessages context-collapse [next]
5. verify     — CliVerifier + ApiVerifier self-correction [next]
6. swarm      — SwarmOrchestrator + sandboxes [next]
"""

__version__ = "1.0.0"
__all__ = ["config", "models", "llm", "soul", "two_model"]
