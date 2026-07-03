// Node test harness for the browser AI core (uses MemStore, no IndexedDB/DOM).
import assert from "node:assert";
import { MemStore } from "../assets/js/store.js";
import { SuperBrain, MODELS } from "../assets/js/brain.js";
import { TokenBank } from "../assets/js/tokens.js";
import { Harvester } from "../assets/js/harvester.js";

let pass = 0;
function ok(msg) { pass++; console.log("  ok:", msg); }

const store = new MemStore();
const brain = new SuperBrain(store);
await brain.init();
ok(`brain init seeded KB, docs=${await store.docCount()}`);
assert.ok((await store.docCount()) >= 40, "KB should seed ~45 docs");

// built-in knowledge answers real code questions immediately
for (const [q, needle] of [
  ["how do I reverse a string in python", "[::-1]"],
  ["javascript async await fetch", "await"],
  ["sql join two tables", "JOIN"],
  ["rust ownership borrowing", "borrow"],
  ["big o time complexity", "O("],
]) {
  const r = await brain.respond(q, "super-coder");
  assert.ok(r.length > 20, "non-empty answer");
  console.log(`  code[${needle}]:`, r.slice(0, 70).replace(/\n/g, " "), "...");
}
ok("code questions answered from built-in KB");

// all models respond
for (const m of Object.keys(MODELS)) {
  const r = await brain.respond("what is machine learning and neural networks", m);
  assert.ok(typeof r === "string" && r.length > 10, `${m} responds`);
}
ok("all 5 models respond");

// greeting + identity
assert.ok((await brain.respond("hello", "super-chat")).length > 20, "greeting responds");
assert.ok((await brain.respond("who are you?", "super-chat")).includes("no external API"));
ok("greeting + identity");

// unknown -> curiosity queue
await brain.respond("zorbium quantum flux xylophone", "super-chat");
const q = await store.getJSON("curiosity_queue", []);
assert.ok(q.length > 0, "curiosity queued");
ok(`curiosity queue: ${JSON.stringify(q)}`);

// neural training + generation + checkpoint reload
const res = await brain.trainNeural(120);
assert.equal(res.trained, 120);
assert.ok(res.loss !== null);
ok(`LlamaLite trained: loss=${res.loss}, steps=${res.total_steps}`);
const gen = brain.llama.generate("machine", 60);
assert.equal(gen.length, 60);
ok(`neural generation len=${gen.length}`);

const brain2 = new SuperBrain(store);
await brain2.init();
assert.equal(brain2.llama.stepsTrained, res.total_steps, "checkpoint restored");
ok(`checkpoint restored: ${brain2.llama.stepsTrained} steps`);

// token bank + daily limit
const bank = new TokenBank(store, 500);
await bank.init();
const uid = "u_test";
assert.equal((await bank.balance(uid)).remaining, 500);
await bank.spend(uid, 480);
assert.ok(!(await bank.canSpend(uid, 100)), "limit blocks");
assert.ok(await bank.canSpend(uid, 10), "small spend passes");
const b = await bank.balance(uid);
assert.equal(b.used, 480);
assert.equal(b.remaining, 20);
ok(`token limit enforced: used=${b.used} remaining=${b.remaining}`);

// per-model cost multiplier
const cheap = bank.costOf("hello world", "reply text here", "super-mini");
const dear = bank.costOf("hello world", "reply text here", "super-sage");
assert.ok(dear > cheap, "sage costs more than mini");
ok(`cost multiplier: mini=${cheap} sage=${dear}`);

// feedback adapts strategy
const before = brain.strategy.retrieval;
await brain.applyFeedback(true, "super-chat");
assert.ok(brain.strategy.retrieval > before, "feedback raised retrieval weight");
ok(`feedback adapts strategy: ${before} -> ${brain.strategy.retrieval.toFixed(2)}`);

// chat learning
const d0 = await store.docCount();
await brain.learnFromChat("Rockets reach orbit by burning liquid oxygen and kerosene in staged combustion engines to gain enormous velocity");
assert.ok((await store.docCount()) > d0, "chat ingested");
ok(`chat learning: docs ${d0} -> ${await store.docCount()}`);

// harvester curiosity resolution is offline-safe (no throw)
const harv = new Harvester(brain, store, 300);
const cur = await harv.resolveCuriosity().catch(() => -1);
assert.ok(cur >= 0, "resolveCuriosity offline-safe");
ok("harvester offline-safe");

// stats + evolution feed
const st = await brain.stats();
assert.ok(st.docs > 0 && st.neural.steps_trained > 0);
const feed = await store.evolutionFeed();
assert.ok(feed.length > 0);
ok(`stats + evolution feed: ${feed.length} events, latest="${feed[0].event}"`);

// ============ NEW: code generation ============
const dup = await brain.respond(
  "Write a Python function called find_duplicates that takes a list of strings and returns a dictionary with duplicate strings as keys and their occurrences as values",
  "super-coder");
assert.ok(dup.includes("def find_duplicates("), "generates the exact requested function");
assert.ok(dup.includes("counts.get(item, 0) + 1"), "real working code");
ok("codegen: find_duplicates generated correctly");

const fibJs = await brain.respond("write fibonacci in javascript", "super-coder");
assert.ok(fibJs.includes("function fibonacci(") && fibJs.includes("javascript"), "js fibonacci");
ok("codegen: fibonacci in JavaScript");

// Hindi code request + Hindi framing
const hiCode = await brain.respond("palindrome check karne ka code banao", "super-chat");
assert.ok(hiCode.includes("def is_palindrome(") || hiCode.includes("function is_palindrome("), "hindi request gives code");
assert.ok(hiCode.includes("Kaise kaam karta hai") || hiCode.includes("aapka code"), "hindi framing");
ok("codegen: Hindi/Hinglish request understood");

// math
const math = await brain.respond("56 * 89 kitna hoga?", "super-chat");
assert.ok(math.includes("4984"), "math answer");
ok(`math: ${math}`);

// small talk
const thx = await brain.respond("thank you!", "super-chat");
assert.ok(thx.length > 10 && !thx.includes("curiosity queue"), "smalltalk works");
const hiThx = await brain.respond("shukriya bhai", "super-chat");
assert.ok(/Koi baat nahi/i.test(hiThx), "hindi smalltalk");
ok("smalltalk: EN + Hinglish");

// relevance gate: an off-topic query must NOT return a garbage mash-up
const off = await brain.respond("mera pet dard kar raha hai kya karu", "super-sage");
assert.ok(off.includes("curiosity") || off.includes("Real Brain") || off.includes("nahi pata"),
  "irrelevant retrieval is gated: " + off.slice(0, 80));
ok("relevance gate: no garbage mash-ups");

// code fallback is honest and points to Real Brain
const fb2 = await brain.respond("write a compiler for brainfuck in zig", "super-coder");
assert.ok(fb2.includes("Real Brain"), "honest fallback suggests Real Brain");
ok("code fallback honest");

console.log(`\nALL ${pass} CHECKS PASSED`);
