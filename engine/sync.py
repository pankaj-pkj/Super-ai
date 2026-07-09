"""MODULE 3 — Network Sync & Flush Gate (backend ↔ frontend GUI).

Bidirectional, loss-free event streaming over WebSocket or SSE.

Design goals
------------
• Zero data loss: events stay in an ordered outbox until the client ACKs them.
  Transport failures / reconnects replay unacked events in order.
• Backpressure: a bounded outbox makes fast producers *await* space instead of
  dropping or exploding memory.
• Serial batching: monotonically-sequenced events flushed in batches by size or
  time, whichever comes first.
• Transport-agnostic: give it any async `sink(batch) -> bool`. WebSocket, SSE
  write, or an in-memory test double all work.

Classes
-------
SerialBatchEventUploader  ordered outbox, seq, batching, retry-until-acked, replay.
FlushGate                 backpressure + flush-timing wrapper with `emit()`.
InboundChannel            ordered, de-duplicated frontend→backend delivery.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel, Field


class SyncEvent(BaseModel):
    seq: int = 0
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    type: str = "message"
    data: Any = None
    ts: float = Field(default_factory=time.time)


# `sink(batch)` returns True when the batch is delivered AND acknowledged.
Sink = Callable[[List[SyncEvent]], Awaitable[bool]]


# ---------------------------------------------------------------------------
# Serial, loss-free uploader
# ---------------------------------------------------------------------------
class SerialBatchEventUploader:
    def __init__(self, sink: Sink, max_batch: int = 32, max_retries: int = 1_000_000):
        self.sink = sink
        self.max_batch = max_batch
        self.max_retries = max_retries
        self._seq = 0
        self._outbox: List[SyncEvent] = []        # ordered, unacked events
        self._acked_through = 0                    # highest contiguous acked seq
        self._lock = asyncio.Lock()
        self.delivered = 0
        self.retries = 0

    def next_seq(self) -> int:
        self._seq += 1
        return self._seq

    async def enqueue(self, event: SyncEvent) -> None:
        async with self._lock:
            if event.seq == 0:
                event.seq = self.next_seq()
            self._outbox.append(event)

    @property
    def pending(self) -> int:
        return len(self._outbox)

    async def ack(self, up_to_seq: int) -> None:
        """Client confirms receipt through `up_to_seq`; drop those from outbox."""
        async with self._lock:
            self._acked_through = max(self._acked_through, up_to_seq)
            self._outbox = [e for e in self._outbox if e.seq > up_to_seq]

    async def flush_once(self) -> int:
        """Try to deliver the next batch. Nothing is dropped unless the sink
        returns True (delivered+acked). Returns count delivered this call."""
        async with self._lock:
            batch = self._outbox[: self.max_batch]
        if not batch:
            return 0
        attempt = 0
        while True:
            try:
                delivered = await self.sink(batch)
            except Exception:
                delivered = False
            if delivered:
                await self.ack(batch[-1].seq)
                self.delivered += len(batch)
                return len(batch)
            # failure → keep events, back off, retry (loss-free)
            self.retries += 1
            attempt += 1
            if attempt > self.max_retries:
                return 0
            await asyncio.sleep(min(0.05 * (2 ** min(attempt, 6)), 5.0))

    def snapshot_unacked(self) -> List[SyncEvent]:
        """Ordered unacked events — replayed verbatim after a reconnect."""
        return list(self._outbox)


# ---------------------------------------------------------------------------
# Flush gate — backpressure + timing
# ---------------------------------------------------------------------------
class FlushGate:
    def __init__(
        self,
        sink: Sink,
        max_batch: int = 32,
        max_interval: float = 0.1,
        max_outbox: int = 10_000,
    ):
        self.uploader = SerialBatchEventUploader(sink, max_batch=max_batch)
        self.max_interval = max_interval
        self.max_outbox = max_outbox
        self._wake = asyncio.Event()
        self._space = asyncio.Event()
        self._space.set()
        self._running = False
        self._flusher: Optional[asyncio.Task] = None

    # ------- producer side (backpressure) -------
    async def emit(self, type: str, data: Any = None) -> SyncEvent:
        # backpressure: block the producer while the outbox is full (never drop)
        while self.uploader.pending >= self.max_outbox:
            self._space.clear()
            self._wake.set()
            await self._space.wait()
        ev = SyncEvent(type=type, data=data)
        await self.uploader.enqueue(ev)
        self._wake.set()
        return ev

    async def ack(self, up_to_seq: int) -> None:
        await self.uploader.ack(up_to_seq)
        if self.uploader.pending < self.max_outbox:
            self._space.set()

    # ------- flusher loop -------
    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.max_interval)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            # drain as many batches as are ready
            while self.uploader.pending > 0:
                sent = await self.uploader.flush_once()
                if self.uploader.pending < self.max_outbox:
                    self._space.set()
                if sent == 0:
                    break

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._flusher = asyncio.create_task(self._loop())

    async def drain(self, timeout: float = 10.0) -> None:
        """Block until every queued event is delivered+acked."""
        deadline = time.time() + timeout
        while self.uploader.pending > 0:
            self._wake.set()
            if time.time() > deadline:
                raise asyncio.TimeoutError("flush gate did not drain in time")
            await asyncio.sleep(0.01)

    async def stop(self) -> None:
        self._running = False
        self._wake.set()
        if self._flusher:
            try:
                await asyncio.wait_for(self._flusher, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._flusher.cancel()

    @property
    def stats(self) -> Dict[str, int]:
        return {
            "pending": self.uploader.pending,
            "delivered": self.uploader.delivered,
            "retries": self.uploader.retries,
        }


# ---------------------------------------------------------------------------
# Inbound (frontend → backend), ordered + de-duplicated
# ---------------------------------------------------------------------------
class InboundChannel:
    def __init__(self, handler: Callable[[SyncEvent], Awaitable[None]]):
        self.handler = handler
        self._seen: set[str] = set()
        self._next_expected = 1
        self._buffer: Dict[int, SyncEvent] = {}
        self._lock = asyncio.Lock()
        self.processed = 0

    async def receive(self, event: SyncEvent) -> None:
        """Accept an event from the client; deliver in-order, ignore duplicates."""
        async with self._lock:
            if event.id in self._seen:
                return  # exactly-once
            self._seen.add(event.id)
            if event.seq and event.seq < self._next_expected:
                return
            if event.seq:
                self._buffer[event.seq] = event
                # flush any now-contiguous run
                while self._next_expected in self._buffer:
                    ev = self._buffer.pop(self._next_expected)
                    self._next_expected += 1
                    await self._dispatch(ev)
            else:
                await self._dispatch(event)

    async def _dispatch(self, event: SyncEvent) -> None:
        self.processed += 1
        try:
            await self.handler(event)
        except Exception:  # a broken handler must not stall the stream
            pass


# ---------------------------------------------------------------------------
# Reference transports (thin, framework-agnostic)
# ---------------------------------------------------------------------------
def websocket_sink(send_json: Callable[[dict], Awaitable[None]],
                   wait_ack: Optional[Callable[[], Awaitable[bool]]] = None) -> Sink:
    """Adapt a WebSocket to a FlushGate sink. `send_json` sends one frame; if
    `wait_ack` is given, delivery isn't confirmed until it returns True."""
    async def sink(batch: List[SyncEvent]) -> bool:
        await send_json({"events": [e.model_dump() for e in batch]})
        return await wait_ack() if wait_ack else True
    return sink


def sse_sink(write: Callable[[str], Awaitable[None]]) -> Sink:
    """Adapt an SSE response writer to a FlushGate sink (fire-and-forget with
    client-side EventSource auto-reconnect + Last-Event-ID replay)."""
    async def sink(batch: List[SyncEvent]) -> bool:
        for e in batch:
            await write(f"id: {e.seq}\nevent: {e.type}\ndata: {e.model_dump_json()}\n\n")
        return True
    return sink
