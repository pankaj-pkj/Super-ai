"""Module 3 smoke test — flush gate, zero-loss, backpressure, reconnect, inbound."""

import asyncio
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.sync import FlushGate, InboundChannel, SerialBatchEventUploader, SyncEvent


async def main() -> None:
    n = 0
    def ok(m):
        nonlocal n; n += 1; print("  ok:", m)

    # ---- zero-loss + exactly-once ordering through a FLAKY sink ----
    received: list[int] = []
    async def flaky_sink(batch):
        if random.random() < 0.4:            # 40% of deliveries fail
            return False
        received.extend(e.data for e in batch)
        return True

    gate = FlushGate(flaky_sink, max_batch=8, max_interval=0.02)
    await gate.start()
    for i in range(200):
        await gate.emit("msg", i)
    await gate.drain(timeout=15)
    await gate.stop()
    assert received == list(range(200)), "events lost / reordered / duplicated"
    ok(f"zero-loss + in-order through a 40%-failing sink ({gate.stats['delivered']} delivered, "
       f"{gate.stats['retries']} retries)")

    # ---- backpressure: tiny outbox forces the producer to await, never drops ----
    slow_gate = FlushGate(_blocking_sink(), max_batch=4, max_interval=0.01, max_outbox=5)
    await slow_gate.start()
    async def burst():
        for i in range(50):
            await slow_gate.emit("x", i)   # will await when outbox is full
    await asyncio.wait_for(burst(), timeout=15)
    await slow_gate.drain(timeout=15)
    await slow_gate.stop()
    assert slow_gate.stats["delivered"] == 50
    ok("backpressure holds producer (bounded memory, 0 drops)")

    # ---- reconnect: unacked events are replayed verbatim, in order ----
    up = SerialBatchEventUploader(_dead_sink(), max_batch=4, max_retries=0)
    for i in range(10):
        await up.enqueue(SyncEvent(type="m", data=i))
    await up.flush_once()                    # sink is "down" → nothing acked
    unacked = up.snapshot_unacked()
    assert [e.data for e in unacked] == list(range(10)), "unacked not preserved"
    got: list[int] = []
    up.sink = _collect_sink(got)             # "reconnect"
    while up.pending:
        await up.flush_once()
    assert got == list(range(10))
    ok("reconnect replays unacked events verbatim, in order (zero loss)")

    # ---- inbound (frontend→backend): ordered + exactly-once ----
    delivered: list[int] = []
    inbound = InboundChannel(lambda ev: _append(delivered, ev.data))
    events = [SyncEvent(seq=i, data=i) for i in range(1, 8)]
    scrambled = events[:]
    random.shuffle(scrambled)
    for ev in scrambled:
        await inbound.receive(ev)
    await inbound.receive(events[2])         # duplicate — must be ignored
    assert delivered == [1, 2, 3, 4, 5, 6, 7], delivered
    assert inbound.processed == 7
    ok("inbound delivers in-order + dedupes out-of-order/duplicate frames")

    # ---- explicit ack frees backpressure ----
    up2 = SerialBatchEventUploader(_collect_sink([]), max_batch=100)
    for i in range(5):
        await up2.enqueue(SyncEvent(data=i))
    await up2.ack(3)
    assert up2.pending == 2, up2.pending
    ok("explicit ack(seq) drops acknowledged events from the outbox")

    print(f"\nALL {n} MODULE-3 CHECKS PASSED")


def _blocking_sink():
    async def sink(batch):
        await asyncio.sleep(0.02)            # slow consumer
        return True
    return sink


def _dead_sink():
    async def sink(batch):
        return False                         # always down
    return sink


def _collect_sink(store):
    async def sink(batch):
        store.extend(e.data for e in batch)
        return True
    return sink


async def _append(store, v):
    store.append(v)


if __name__ == "__main__":
    random.seed(7)
    asyncio.run(main())
