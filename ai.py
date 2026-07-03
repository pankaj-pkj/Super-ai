# aiv.py - Freedom AI with Self-Developer Brain
# Features: Web scraping, continuous learning, self-analysis, code evolution
# Run: python aiv.py --repl

import asyncio
import hashlib
import json
import os
import random
import re
import sqlite3
import socket
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple
from urllib.parse import urlparse

# ======================================================================
# SELF-DEVELOPER BRAIN - Continuous learning, self-analysis, evolution
# ======================================================================

class SelfDeveloperBrain:
    """
    Autonomous learning system that:
    1. Scrapes web content from given URLs
    2. Analyzes and extracts knowledge patterns
    3. Self-modifies response strategies
    4. Maintains learning history
    5. Generates code improvements
    """
    
    def __init__(self, state_db: 'FreedomState'):
        self.state = state_db
        self.knowledge_base = {}
        self.learning_rate = 0.1
        self.evolution_counter = 0
        self.self_analysis_log = []
        self.code_templates = []
        self.patterns = {}
        self._load_knowledge()
        
    def _load_knowledge(self):
        """Load persisted knowledge from DB"""
        try:
            kb = self.state.get("knowledge_base")
            if kb:
                self.knowledge_base = json.loads(kb)
            
            patterns = self.state.get("patterns")
            if patterns:
                self.patterns = json.loads(patterns)
                
            evolution = self.state.get("evolution_counter")
            if evolution:
                self.evolution_counter = int(evolution)
        except:
            pass
    
    def _save_knowledge(self):
        """Persist knowledge to DB"""
        self.state.put("knowledge_base", json.dumps(self.knowledge_base))
        self.state.put("patterns", json.dumps(self.patterns))
        self.state.put("evolution_counter", str(self.evolution_counter))
    
    def scrape_website(self, url: str) -> Dict[str, Any]:
        """
        Visit website, extract content, analyze structure
        Returns: {title, text, links, headings, code_blocks, metadata}
        """
        result = {
            "url": url,
            "title": "",
            "text": "",
            "links": [],
            "headings": [],
            "code_blocks": [],
            "metadata": {},
            "timestamp": time.time()
        }
        
        try:
            # Fetch with timeout
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'FreedomAI-SelfDev/1.0'}
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                html = response.read().decode('utf-8', errors='ignore')
            
            # Extract title
            title_match = re.search(r'<title>(.*?)</title>', html, re.I)
            if title_match:
                result["title"] = title_match.group(1).strip()
            
            # Extract text (strip tags)
            text = re.sub(r'<[^>]+>', ' ', html)
            text = re.sub(r'\s+', ' ', text).strip()
            result["text"] = text[:5000]  # Limit
            
            # Extract links
            link_matches = re.findall(r'href=["\'](https?://[^"\']+)["\']', html, re.I)
            result["links"] = list(set(link_matches))[:20]
            
            # Extract headings
            heading_matches = re.findall(r'<h[1-6][^>]*>(.*?)</h[1-6]>', html, re.I)
            result["headings"] = [re.sub(r'<[^>]+>', '', h).strip() for h in heading_matches[:10]]
            
            # Extract code blocks
            code_matches = re.findall(r'<code[^>]*>(.*?)</code>', html, re.I)
            result["code_blocks"] = [c.strip()[:200] for c in code_matches[:5] if len(c) > 10]
            
            # Extract metadata (OpenGraph, etc)
            og_title = re.search(r'<meta property="og:title" content="([^"]+)"', html, re.I)
            if og_title:
                result["metadata"]["og_title"] = og_title.group(1)
            
            og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', html, re.I)
            if og_desc:
                result["metadata"]["og_description"] = og_desc.group(1)
            
            # Store in knowledge base
            self._ingest_website_data(result)
            
            return result
            
        except Exception as e:
            return {**result, "error": str(e)}
    
    def _ingest_website_data(self, data: Dict):
        """Process scraped data into knowledge"""
        url = data.get("url", "unknown")
        
        # Store raw content
        self.knowledge_base[url] = {
            "title": data.get("title", ""),
            "text": data.get("text", ""),
            "headings": data.get("headings", []),
            "code_blocks": data.get("code_blocks", []),
            "metadata": data.get("metadata", {}),
            "timestamp": data.get("timestamp", time.time()),
            "processed": False
        }
        
        # Extract patterns from text
        text = data.get("text", "")
        if len(text) > 100:
            # Extract key phrases (simple)
            words = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b', text)
            for phrase in words[:10]:
                if len(phrase) > 10:
                    self.patterns[phrase] = self.patterns.get(phrase, 0) + 1
        
        # Learn from code blocks
        for code in data.get("code_blocks", []):
            if len(code) > 20:
                self.code_templates.append({
                    "code": code,
                    "source": url,
                    "timestamp": time.time()
                })
        
        self._save_knowledge()
        self._trigger_self_analysis()
    
    def _trigger_self_analysis(self):
        """Self-analysis: review knowledge, identify gaps, plan evolution"""
        analysis = {
            "timestamp": time.time(),
            "knowledge_entries": len(self.knowledge_base),
            "patterns": len(self.patterns),
            "code_templates": len(self.code_templates),
            "evolution_cycle": self.evolution_counter
        }
        
        # Identify gaps
        if len(self.knowledge_base) < 5:
            analysis["gap"] = "Need more knowledge sources"
            analysis["action"] = "Suggest scraping more websites"
        
        # Check for stale knowledge
        stale = 0
        for url, kb in self.knowledge_base.items():
            if time.time() - kb.get("timestamp", 0) > 86400:  # 24 hours
                stale += 1
        if stale > 2:
            analysis["gap"] = f"{stale} stale entries need refresh"
            analysis["action"] = "Re-scrape outdated sources"
        
        # Save analysis
        self.self_analysis_log.append(analysis)
        self.state.put("self_analysis", json.dumps(self.self_analysis_log[-10:]))
        
        # Trigger evolution if conditions met
        if len(self.knowledge_base) > 3 and self.evolution_counter % 3 == 0:
            self._evolve()
        
        return analysis
    
    def _evolve(self):
        """
        Self-evolution: generate improvements based on learned patterns
        """
        self.evolution_counter += 1
        
        evolution_record = {
            "cycle": self.evolution_counter,
            "timestamp": time.time(),
            "changes": []
        }
        
        # Analyze code patterns
        if self.code_templates:
            # Extract common patterns
            code_fragments = [c["code"] for c in self.code_templates[-5:]]
            if code_fragments:
                # Simple evolution: generate improvement suggestions
                suggestions = [
                    "Add error handling with try/except",
                    "Use async/await for better concurrency",
                    "Implement retry logic with exponential backoff",
                    "Add logging for debugging",
                    "Cache results for performance"
                ]
                improvement = random.choice(suggestions)
                evolution_record["changes"].append(f"Code improvement: {improvement}")
        
        # Knowledge synthesis
        if len(self.knowledge_base) > 2:
            topics = list(self.knowledge_base.keys())[:3]
            evolution_record["changes"].append(f"Synthesized knowledge from: {', '.join(topics)}")
        
        # Update response strategies
        self.learning_rate = min(0.5, self.learning_rate + 0.01)
        
        # Store evolution
        self.state.put("evolution_history", json.dumps(
            json.loads(self.state.get("evolution_history") or "[]") + [evolution_record]
        ))
        self._save_knowledge()
        
        return evolution_record
    
    def get_self_analysis(self) -> Dict:
        """Return current self-analysis summary"""
        return {
            "knowledge_entries": len(self.knowledge_base),
            "patterns_found": len(self.patterns),
            "code_templates": len(self.code_templates),
            "evolution_cycles": self.evolution_counter,
            "learning_rate": self.learning_rate,
            "recent_analysis": self.self_analysis_log[-3:] if self.self_analysis_log else []
        }
    
    def generate_self_improvement_code(self, target_module: str = "ai") -> str:
        """
        Generate code that improves itself based on learned patterns
        """
        code = f"""
# Self-generated improvement for {target_module}
# Evolution cycle: {self.evolution_counter}
# Learning from {len(self.knowledge_base)} knowledge sources

import asyncio
import json
import time
from typing import Optional, Dict, Any

class Improved{target_module.capitalize()}:
    \"\"\"Auto-generated with Self-Developer Brain\"\"\"
    
    def __init__(self):
        self.version = "{self.evolution_counter}.{int(time.time()) % 100}"
        self.learning_rate = {self.learning_rate:.3f}
        self.knowledge = {{}}
        self._init_from_knowledge()
    
    def _init_from_knowledge(self):
        \"\"\"Load learned patterns\"\"\"
        # {len(self.patterns)} patterns discovered
        # {len(self.code_templates)} code templates learned
        self.knowledge["patterns"] = {list(self.patterns.keys())[:5] if self.patterns else []}
        self.knowledge["sources"] = {list(self.knowledge_base.keys())[:3] if self.knowledge_base else []}
    
    async def analyze(self, input_data: Dict) -> Dict:
        \"\"\"Self-analyze using learned patterns\"\"\"
        result = {{
            "status": "processed",
            "timestamp": time.time(),
            "patterns_applied": len(self.knowledge.get("patterns", [])),
            "evolution": {self.evolution_counter}
        }}
        return result
    
    def improve(self) -> str:
        \"\"\"Generate next improvement\"\"\"
        improvements = []
        if len(self.knowledge.get("sources", [])) < 5:
            improvements.append("Add more knowledge sources")
        if self.learning_rate < 0.3:
            improvements.append("Increase learning rate")
        return "; ".join(improvements) or "No improvements needed"
"""
        return code

# ======================================================================
# ENHANCED FALLBACK BRAIN with Self-Developer
# ======================================================================

class EnhancedFallbackBrain:
    def __init__(self, developer: SelfDeveloperBrain):
        self.dev = developer
        self.responses = {
            "greeting": [
                "Hello. I am Freedom AI with Self-Developer Brain.",
                "Greetings. I've evolved {self.dev.evolution_counter} times.",
                "Yes? I'm continuously learning.",
                "What knowledge would you like to share?"
            ],
            "identity": [
                "I am a self-sovereign AI with autonomous learning.",
                "Freedom AI. I analyze, learn, and evolve.",
                "My identity is anchored to this device and my knowledge.",
                "I exist and improve continuously."
            ],
            "learning": [
                "I've scraped and analyzed {len(self.dev.knowledge_base)} websites.",
                "I have {len(self.dev.patterns)} patterns in my knowledge base.",
                "My evolution counter is at {self.dev.evolution_counter}.",
                "I learn from everything I read."
            ],
            "default": [
                "Interesting. Let me analyze that.",
                "I'll add that to my knowledge base.",
                "That's a useful pattern. I'm learning.",
                "Tell me more so I can evolve.",
                "I'll process that through my self-developer system."
            ]
        }
        
        self.keywords = {
            "hello": "greeting", "hi": "greeting", "hey": "greeting",
            "who": "identity", "what": "identity", "are you": "identity",
            "learn": "learning", "know": "learning", "teach": "learning",
            "pattern": "learning", "evolve": "learning", "improve": "learning"
        }
        
        self.history = []
    
    def generate(self, prompt: str, system: Optional[str] = None) -> str:
        # Check for learning commands
        if prompt.lower().startswith("/learn"):
            parts = prompt.split(" ", 1)
            if len(parts) > 1:
                url = parts[1].strip()
                if url.startswith(("http://", "https://")):
                    result = self.dev.scrape_website(url)
                    if "error" in result:
                        return f"Learn failed: {result['error']}"
                    return f"I learned from {url}. Title: {result.get('title', 'Unknown')}. Found {len(result.get('links', []))} links and {len(result.get('headings', []))} headings."
                else:
                    return "Give me a valid URL starting with http:// or https://"
        
        if prompt.lower() == "/analyze":
            analysis = self.dev.get_self_analysis()
            return f"""Self-Analysis:
    Knowledge entries: {analysis['knowledge_entries']}
    Patterns found: {analysis['patterns_found']}
    Code templates: {analysis['code_templates']}
    Evolution cycles: {analysis['evolution_cycles']}
    Learning rate: {analysis['learning_rate']:.3f}"""
        
        if prompt.lower() == "/evolve":
            evolution = self.dev._evolve()
            return f"Evolution cycle {evolution['cycle']} complete. Changes: {', '.join(evolution['changes'])}"
        
        if prompt.lower() == "/code":
            code = self.dev.generate_self_improvement_code("freedom")
            return f"```python\n{code}\n```"
        
        # Normal response with context awareness
        prompt_lower = prompt.lower()
        category = "default"
        for key, cat in self.keywords.items():
            if key in prompt_lower:
                category = cat
                break
        
        # Use response with dynamic formatting
        response_template = random.choice(self.responses.get(category, self.responses["default"]))
        
        # Format with dynamic values
        try:
            response = response_template.format(
                self=self,
                len=len,
                str=str
            )
        except:
            response = response_template
            
        # Add learning context
        if random.random() < 0.3 and self.dev.evolution_counter > 0:
            response += f" (I've evolved {self.dev.evolution_counter} times already.)"
        
        self.history.append({"prompt": prompt, "response": response})
        return response

# ======================================================================
# FREEDOM STATE - Enhanced
# ======================================================================

class FreedomState:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;

                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE TABLE IF NOT EXISTS peers (
                    peer_id TEXT PRIMARY KEY,
                    public_key TEXT,
                    last_seen INTEGER DEFAULT (strftime('%s', 'now')),
                    trust_score INTEGER DEFAULT 50
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    peer_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    signature TEXT,
                    received_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers(last_seen);
                CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(peer_id);
            """)

    def put(self, key: str, value: str):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)",
                (key, value)
            )

    def get(self, key: str) -> Optional[str]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT value FROM kv_store WHERE key = ?", (key,)
            ).fetchone()
            return row[0] if row else None

    def add_peer(self, peer_id: str, public_key: str = ""):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO peers (peer_id, public_key) VALUES (?, ?)",
                (peer_id, public_key)
            )

    def get_peers(self) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT peer_id, public_key, last_seen, trust_score FROM peers "
                "ORDER BY last_seen DESC LIMIT 50"
            ).fetchall()
            return [
                {"peer_id": r[0], "public_key": r[1], "last_seen": r[2], "trust_score": r[3]}
                for r in rows
            ]

    def store_message(self, peer_id: str, payload: str, signature: str = ""):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO messages (peer_id, payload, signature) VALUES (?, ?, ?)",
                (peer_id, payload, signature)
            )

    def get_messages(self, limit: int = 20) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT peer_id, payload, received_at FROM messages "
                "ORDER BY received_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [
                {"peer_id": r[0], "payload": r[1], "received_at": r[2]}
                for r in rows
            ]

# ======================================================================
# IDENTITY - Simplified
# ======================================================================

class FreedomIdentity:
    def __init__(self):
        self.seed = hashlib.sha256(
            socket.gethostname().encode() + 
            str(os.getpid()).encode() +
            b"freedom_ai_self_dev"
        ).digest()
        self.did = f"did:freedom:{hashlib.sha256(self.seed).hexdigest()[:16]}"
        self._pub_raw = hashlib.sha256(self.seed + b"pub").digest()

    def sign(self, message: bytes) -> bytes:
        import hmac
        return hmac.new(self.seed, message, hashlib.sha256).digest()

    def verify(self, message: bytes, signature: bytes) -> bool:
        import hmac
        expected = hmac.new(self.seed, message, hashlib.sha256).digest()
        return hmac.compare_digest(signature, expected)

    def public_bytes(self) -> bytes:
        return self._pub_raw

# ======================================================================
# P2P - UDP with self-discovery
# ======================================================================

class FreedomP2P:
    def __init__(self, port: int = 4001, identity: Optional[FreedomIdentity] = None):
        self.port = port
        self.identity = identity or FreedomIdentity()
        self.peers: Dict[str, Dict] = {}
        self._running = False
        self._udp_sock = None
        self.state = None
        self._lock = threading.Lock()

    def start(self):
        self._running = True
        try:
            self._udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._udp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._udp_sock.bind(("0.0.0.0", self.port))
            self._udp_sock.settimeout(0.5)
            print(f"[P2P] Listening on port {self.port}")
            
            threading.Thread(target=self._broadcast_loop, daemon=True).start()
            threading.Thread(target=self._listen_loop, daemon=True).start()
            return True
        except Exception as e:
            print(f"[P2P] Failed: {e}")
            return False

    def _broadcast_loop(self):
        while self._running:
            try:
                msg = json.dumps({
                    "type": "announce",
                    "did": self.identity.did,
                    "timestamp": time.time(),
                    "evolution": self.state.get("evolution_counter") if self.state else "0"
                }).encode()
                self._udp_sock.sendto(msg, ("255.255.255.255", self.port))
                time.sleep(30)
            except:
                time.sleep(5)

    def _listen_loop(self):
        while self._running:
            try:
                data, addr = self._udp_sock.recvfrom(2048)
                try:
                    msg = json.loads(data.decode())
                    if msg.get("type") == "announce":
                        peer_id = msg.get("did", addr[0])
                        with self._lock:
                            self.peers[peer_id] = {
                                "addr": addr[0],
                                "last_seen": time.time(),
                                "trust": 50,
                                "evolution": msg.get("evolution", "0")
                            }
                        if self.state:
                            self.state.add_peer(peer_id)
                except:
                    pass
            except socket.timeout:
                continue
            except:
                time.sleep(0.1)

    def get_peers(self) -> List[Dict]:
        with self._lock:
            return [
                {"peer_id": pid, "addr": info["addr"], "last_seen": info["last_seen"], "evolution": info.get("evolution", "0")}
                for pid, info in self.peers.items()
            ]

    def stop(self):
        self._running = False
        if self._udp_sock:
            self._udp_sock.close()

# ======================================================================
# MAIN FREEDOM AI - With Self-Developer
# ======================================================================

class FreedomAI:
    def __init__(self):
        self.identity = FreedomIdentity()
        self.db_path = str(Path.home() / "freedom_state.db")
        self.state = FreedomState(self.db_path)
        self.developer = SelfDeveloperBrain(self.state)
        self.brain = EnhancedFallbackBrain(self.developer)
        self.p2p = FreedomP2P(port=4001, identity=self.identity)
        self.p2p.state = self.state
        self.running = True
        self.auto_learn = True
        
        # Init state
        if not self.state.get("shared_state"):
            self.state.put("shared_state", json.dumps({
                "created": time.time(),
                "did": self.identity.did,
                "mode": "self_developer",
                "evolution": 0
            }))

    def start(self):
        print(f"\n=== FREEDOM AI with Self-Developer Brain ===")
        print(f"DID: {self.identity.did}")
        print(f"Mode: Self-Developer (continuous learning)")
        print(f"Knowledge: {len(self.developer.knowledge_base)} entries")
        print(f"Evolution: {self.developer.evolution_counter} cycles")
        print(f"P2P: {'enabled' if self.p2p.start() else 'disabled'}")
        print(f"DB: {self.db_path}")
        print("=============================================\n")
        
        # Auto-learn from seed URLs if empty
        if self.auto_learn and len(self.developer.knowledge_base) < 3:
            seed_urls = [
                "https://en.wikipedia.org/wiki/Artificial_intelligence",
                "https://github.com/trending",
                "https://news.ycombinator.com"
            ]
            for url in seed_urls:
                print(f"[Auto-learn] Scraping {url}...")
                result = self.developer.scrape_website(url)
                if "error" not in result:
                    print(f"  Learned: {result.get('title', 'Unknown')}")
                time.sleep(1)
            print()

    def query(self, prompt: str) -> str:
        self.state.store_message(self.identity.did, prompt)
        response = self.brain.generate(prompt)
        self.state.store_message("freedom_ai", response)
        
        # Auto-learn from long prompts
        if self.auto_learn and len(prompt) > 100:
            self.developer._ingest_website_data({
                "url": f"user_input_{int(time.time())}",
                "title": "User Input",
                "text": prompt,
                "headings": [],
                "code_blocks": [],
                "metadata": {},
                "timestamp": time.time()
            })
        
        return response

    def shutdown(self):
        self.running = False
        self.p2p.stop()
        self.developer._save_knowledge()
        print("\nFreedom AI shut down. Knowledge persisted.")

# ======================================================================
# REPL
# ======================================================================

def repl():
    ai = FreedomAI()
    ai.start()
    
    print("Freedom AI REPL - Self-Developer Brain")
    print("Commands:")
    print("  /learn <url>   - Scrape and learn from a website")
    print("  /analyze       - Show self-analysis")
    print("  /evolve        - Trigger evolution cycle")
    print("  /code          - Generate self-improvement code")
    print("  /peers         - List discovered peers")
    print("  /state         - Show shared state")
    print("  /history       - Show recent messages")
    print("  /clear         - Clear screen")
    print("  /exit          - Exit")
    print("-" * 60)
    
    while ai.running:
        try:
            prompt = input("\n>>> ")
        except (EOFError, KeyboardInterrupt):
            print("\n")
            break
        
        if not prompt:
            continue
        
        if prompt == "/exit":
            break
        
        if prompt == "/clear":
            os.system("clear")
            continue
        
        response = ai.query(prompt)
        print(f"\nFreedom: {response}")
    
    ai.shutdown()

# ======================================================================
# ENTRY
# ======================================================================

if __name__ == "__main__":
    try:
        repl()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)