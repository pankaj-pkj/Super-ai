// codegen.js — makes Super AI actually WRITE code, do math, small-talk,
// and understand Hindi/Hinglish. Pure local logic, no API.

// ---------------- Hindi / Hinglish detection ----------------
const HINGLISH_RE = /\b(kya|kaise|kaisa|kaun|kyu|kyun|kyon|karo|kar do|krdo|kardo|banao|bana do|banado|likho|likh do|batao|bata do|chahiye|mujhe|hume|humko|nahi|nhi|matlab|samjhao|samjha|kitna|kitne|wala|wali|dede|de do|hota|hoga|hogi|bhai|yaar|acha|accha|theek|thik|shukriya|dhanyavad|namaste|aap|tum|mera|tera|apna)\b/i;

export function isHindi(text) {
  return /[ऀ-ॿ]/.test(text) || HINGLISH_RE.test(text);
}

// ---------------- safe math ----------------
export function tryMath(prompt) {
  const wantsMath = /(calculate|solve|evaluate|what is|kitna|kitne|kya hoga|kya hota|hota h|hoga|=|\bplus\b|\bmath\b|जोड़|गुणा)/i.test(prompt);
  const candidates = (prompt.match(/[-\d+*/%().\s]{3,}/g) || [])
    .map((s) => s.trim())
    .filter((s) => /\d/.test(s) && /[+\-*/%]/.test(s) && /^[\d+\-*/%().\s]+$/.test(s) && s.length <= 80);
  if (!candidates.length) return null;
  const expr = candidates.sort((a, b) => b.length - a.length)[0];
  // only treat as math if it's clearly a math question or the message IS the expression
  if (!wantsMath && expr.replace(/\s/g, "").length < prompt.replace(/\s/g, "").length * 0.5) return null;
  try {
    const val = Function('"use strict";return (' + expr + ")")();
    if (typeof val === "number" && isFinite(val)) {
      const v = Math.round(val * 1e8) / 1e8;
      return isHindi(prompt)
        ? `**${expr.replace(/\s+/g, " ")} = ${v}** hota hai. ✅`
        : `**${expr.replace(/\s+/g, " ")} = ${v}** ✅`;
    }
  } catch { /* not valid math */ }
  return null;
}

// ---------------- small talk (EN + Hinglish) ----------------
const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
  "There are only 10 types of people: those who understand binary and those who don't. 😄",
  "A SQL query walks into a bar, goes up to two tables and asks: \"Can I JOIN you?\" 🍻",
  "Programmer ki shaadi me sab bole: 'commit kar do bhai, ab push bhi kar do!' 😆",
];

export function trySmallTalk(prompt) {
  const p = prompt.toLowerCase().trim();
  const hi = isHindi(prompt);

  if (/^(how are you|kaise ho|kaisa hai|kaise hain|kya haal|sab (theek|thik))\b/i.test(p) || /how are you/.test(p))
    return hi ? "Main badhiya hu! 🧠 Har second seekh raha hu — GitHub se, web se, aur aapki chats se. Aap batao, kya banaye aaj?"
              : "I'm great! 🧠 Learning every second — from GitHub, the web, and your chats. What shall we build today?";

  if (/thank(s| you)|dhanyavad|shukriya|thnx|thanku/i.test(p))
    return hi ? "Koi baat nahi! 😊 Aur kuch chahiye to batao — code, explanation, kuch bhi." : "You're welcome! 😊 Ask me anything else — code, explanations, whatever you need.";

  if (/(your|tumhara|tera|aapka|apka)\s*(name|naam)|who made you|kisne banaya/i.test(p))
    return hi ? "Mera naam **Super AI** hai — ek self-training mind jo 100% aapke browser me chalti hai, bina kisi API ke. Mujhe is repo ke code ne banaya hai aur main roz khud ko improve karti hu."
              : "I'm **Super AI** — a self-training mind running 100% in your browser, no API. I improve myself every day.";

  if (/\bjoke\b|chutkula|hasao|funny/i.test(p))
    return JOKES[Math.floor(Math.random() * JOKES.length)];

  if (/good (morning|night|evening|afternoon)|shubh (prabhat|ratri)/i.test(p))
    return hi ? "Shubh din! 🌞 Chalo kuch naya seekhte-banate hain." : "Good day to you! 🌞 Let's learn or build something new.";

  if (/what can you do|kya kar sakt|features|abilities/i.test(p))
    return hi
      ? "Main ye sab kar sakti hu:\n• **Code likhna** — 'palindrome check ka code banao' bolo\n• **Math** — '56*89 kitna hoga'\n• **Programming help** — 20+ languages ka built-in gyaan\n• **Real Brain 🧩** — sidebar me select karo, asli LLM (Llama/Qwen) aapke browser me hi chalega, bina API ke\n• **Khud seekhna 24×7** — GitHub, Wikipedia, aur aapki chats se\n• **URL se sikhana** — 'Teach from URL' button"
      : "Here's what I can do:\n• **Write code** — try 'write a function to find duplicates'\n• **Math** — 'what is 56*89'\n• **Programming help** — built-in knowledge of 20+ languages\n• **Real Brain 🧩** — pick it in the sidebar to run a real LLM (Llama/Qwen) inside your browser, no API\n• **Self-learn 24×7** — from GitHub, Wikipedia and your chats\n• **Teach from URL**";

  if (/(what|kya|kitne).*(time|samay|baje)|time (kya|batao)|kitne baje/i.test(p))
    return (hi ? "Abhi time hai: " : "The time is: ") + new Date().toLocaleTimeString();

  if (/(what|kya|aaj).*(date|tarikh|din)|date (kya|batao)/i.test(p))
    return (hi ? "Aaj hai: " : "Today is: ") + new Date().toDateString();

  return null;
}

// ---------------- code generation ----------------

function detectLang(prompt) {
  if (/\b(python|py)\b/i.test(prompt)) return "python";
  if (/\b(javascript|js|node(js)?)\b/i.test(prompt)) return "javascript";
  if (/\b(html|web ?page|website)\b/i.test(prompt)) return "html";
  if (/\bjava\b(?!script)/i.test(prompt)) return "java";
  if (/c\+\+|\bcpp\b/i.test(prompt)) return "cpp";
  if (/\bc#|csharp/i.test(prompt)) return "csharp";
  if (/\b(golang|\bgo\b)\b/i.test(prompt)) return "go";
  if (/\brust\b/i.test(prompt)) return "rust";
  return null; // default decided per-template
}

function fnName(prompt, dflt) {
  const m = prompt.match(/(?:called|named|naam|name)\s+["']?([A-Za-z_][A-Za-z0-9_]*)/i);
  return m ? m[1] : dflt;
}

// each template: re (topic match), fn default name, py/js/html generators
const TEMPLATES = [
  {
    re: /duplicat|dobara|repeat(ed)? (item|element|string)/i, fn: "find_duplicates",
    py: (f) => `def ${f}(items):
    counts = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return {k: v for k, v in counts.items() if v > 1}

print(${f}(["a", "b", "a", "c", "b", "a"]))  # {'a': 3, 'b': 2}`,
    js: (f) => `function ${f}(items) {
  const counts = {};
  for (const it of items) counts[it] = (counts[it] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 1));
}

console.log(${f}(["a", "b", "a", "c", "b", "a"])); // { a: 3, b: 2 }`,
    en: "counts every item, then keeps only the ones that appear more than once",
    hi: "har item ko count karta hai, phir sirf wahi rakhta hai jo 1 se zyada baar aaye",
  },
  {
    re: /fibonacci|fibonaci/i, fn: "fibonacci",
    py: (f) => `def ${f}(n):
    a, b = 0, 1
    seq = []
    for _ in range(n):
        seq.append(a)
        a, b = b, a + b
    return seq

print(${f}(10))  # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]`,
    js: (f) => `function ${f}(n) {
  const seq = [];
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) { seq.push(a); [a, b] = [b, a + b]; }
  return seq;
}

console.log(${f}(10)); // [0,1,1,2,3,5,8,13,21,34]`,
    en: "iteratively builds the sequence — O(n), no recursion overflow",
    hi: "loop se sequence banata hai — O(n), recursion ka jhanjhat nahi",
  },
  {
    re: /palindrome/i, fn: "is_palindrome",
    py: (f) => `def ${f}(s):
    s = "".join(c.lower() for c in s if c.isalnum())
    return s == s[::-1]

print(${f}("Nitin"))          # True
print(${f}("A man, a plan"))  # False`,
    js: (f) => `function ${f}(s) {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t === t.split("").reverse().join("");
}

console.log(${f}("Nitin")); // true`,
    en: "cleans the string, then compares it with its reverse",
    hi: "string saaf karke usko ulta karke compare karta hai",
  },
  {
    re: /\bprime\b|abhajya/i, fn: "is_prime",
    py: (f) => `def ${f}(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True

print([x for x in range(30) if ${f}(x)])  # [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]`,
    js: (f) => `function ${f}(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

console.log([...Array(30).keys()].filter(${f})); // [2,3,5,7,...]`,
    en: "checks divisors only up to √n — fast for large numbers",
    hi: "sirf √n tak divisors check karta hai — bade numbers ke liye fast",
  },
  {
    re: /factorial/i, fn: "factorial",
    py: (f) => `def ${f}(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

print(${f}(5))  # 120`,
    js: (f) => `function ${f}(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

console.log(${f}(5)); // 120`,
    en: "iterative version — avoids recursion limits",
    hi: "loop wala version — recursion limit ki dikkat nahi",
  },
  {
    re: /revers.*(string|list|array|word)|ulta (kar|karo|karna)|reverse/i, fn: "reverse_it",
    py: (f) => `def ${f}(s):
    return s[::-1]

print(${f}("hello"))      # olleh
print(${f}([1, 2, 3]))    # [3, 2, 1]`,
    js: (f) => `function ${f}(x) {
  return typeof x === "string" ? x.split("").reverse().join("") : [...x].reverse();
}

console.log(${f}("hello")); // "olleh"`,
    en: "works for both strings and lists",
    hi: "string aur list dono ke liye kaam karta hai",
  },
  {
    re: /\bsort\b|sorting|chota.*bada|ascending|descending/i, fn: "sort_items",
    py: (f) => `def ${f}(items, descending=False):
    return sorted(items, reverse=descending)

print(${f}([5, 2, 9, 1]))                  # [1, 2, 5, 9]
print(${f}(["b", "a"], descending=True))   # ['b', 'a']`,
    js: (f) => `function ${f}(items, descending = false) {
  const arr = [...items].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  return descending ? arr.reverse() : arr;
}

console.log(${f}([5, 2, 9, 1])); // [1, 2, 5, 9]`,
    en: "returns a new sorted copy; pass descending=true to flip",
    hi: "nayi sorted copy return karta hai; descending=true se ulta",
  },
  {
    re: /sum|average|\bmean\b|jod(o|na)?|total.*(list|array|number)/i, fn: "sum_and_average",
    py: (f) => `def ${f}(nums):
    total = sum(nums)
    return total, total / len(nums) if nums else 0

s, avg = ${f}([10, 20, 30])
print(s, avg)  # 60 20.0`,
    js: (f) => `function ${f}(nums) {
  const total = nums.reduce((a, b) => a + b, 0);
  return { total, average: nums.length ? total / nums.length : 0 };
}

console.log(${f}([10, 20, 30])); // { total: 60, average: 20 }`,
    en: "one pass for the total, then divides for the average",
    hi: "ek pass me total, phir divide karke average",
  },
  {
    re: /fizz ?buzz/i, fn: "fizzbuzz",
    py: (f) => `def ${f}(n):
    for i in range(1, n + 1):
        out = ("Fizz" if i % 3 == 0 else "") + ("Buzz" if i % 5 == 0 else "")
        print(out or i)

${f}(15)`,
    js: (f) => `function ${f}(n) {
  for (let i = 1; i <= n; i++) {
    const out = (i % 3 === 0 ? "Fizz" : "") + (i % 5 === 0 ? "Buzz" : "");
    console.log(out || i);
  }
}

${f}(15);`,
    en: "the classic interview warm-up",
    hi: "classic interview question",
  },
  {
    re: /vowel/i, fn: "count_vowels",
    py: (f) => `def ${f}(s):
    return sum(1 for c in s.lower() if c in "aeiou")

print(${f}("Programming"))  # 3`,
    js: (f) => `function ${f}(s) {
  return (s.match(/[aeiou]/gi) || []).length;
}

console.log(${f}("Programming")); // 3`,
    en: "counts a, e, i, o, u (case-insensitive)",
    hi: "a, e, i, o, u ginta hai (bade-chhote dono)",
  },
  {
    re: /word count|count words|shabd|har word|frequency of words|word frequency/i, fn: "word_frequency",
    py: (f) => `def ${f}(text):
    freq = {}
    for w in text.lower().split():
        freq[w] = freq.get(w, 0) + 1
    return freq

print(${f}("code eat sleep code"))  # {'code': 2, 'eat': 1, 'sleep': 1}`,
    js: (f) => `function ${f}(text) {
  const freq = {};
  for (const w of text.toLowerCase().split(/\\s+/)) freq[w] = (freq[w] || 0) + 1;
  return freq;
}

console.log(${f}("code eat sleep code")); // { code: 2, eat: 1, sleep: 1 }`,
    en: "splits on whitespace and counts each word",
    hi: "spaces par todkar har word ginta hai",
  },
  {
    re: /leap year|adhivarsh/i, fn: "is_leap_year",
    py: (f) => `def ${f}(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)

print(${f}(2024))  # True
print(${f}(1900))  # False`,
    js: (f) => `function ${f}(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

console.log(${f}(2024)); // true`,
    en: "divisible by 4, except centuries unless divisible by 400",
    hi: "4 se divide ho, lekin century sirf 400 se divide hone par",
  },
  {
    re: /armstrong/i, fn: "is_armstrong",
    py: (f) => `def ${f}(n):
    digits = str(n)
    return n == sum(int(d) ** len(digits) for d in digits)

print(${f}(153))  # True (1³+5³+3³ = 153)`,
    js: (f) => `function ${f}(n) {
  const d = String(n);
  return n === [...d].reduce((s, c) => s + Number(c) ** d.length, 0);
}

console.log(${f}(153)); // true`,
    en: "sum of each digit raised to the number of digits equals the number",
    hi: "har digit ko digits-ki-ginti power dekar jod, number ke barabar ho to Armstrong",
  },
  {
    re: /swap.*(number|two|variable)|adla badli/i, fn: "swap",
    py: (f) => `a, b = 5, 10
a, b = b, a          # pythonic swap
print(a, b)          # 10 5`,
    js: (f) => `let a = 5, b = 10;
[a, b] = [b, a];     // destructuring swap
console.log(a, b);   // 10 5`,
    en: "no temp variable needed",
    hi: "temp variable ki zaroorat nahi",
  },
  {
    re: /binary search/i, fn: "binary_search",
    py: (f) => `def ${f}(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

print(${f}([1, 3, 5, 7, 9], 7))  # 3`,
    js: (f) => `function ${f}(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

console.log(${f}([1, 3, 5, 7, 9], 7)); // 3`,
    en: "O(log n) — the array must be sorted",
    hi: "O(log n) — array sorted hona chahiye",
  },
  {
    re: /bubble sort/i, fn: "bubble_sort",
    py: (f) => `def ${f}(arr):
    a = list(arr)
    for i in range(len(a)):
        for j in range(len(a) - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a

print(${f}([5, 1, 4, 2]))  # [1, 2, 4, 5]`,
    js: (f) => `function ${f}(arr) {
  const a = [...arr];
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < a.length - 1 - i; j++)
      if (a[j] > a[j + 1]) [a[j], a[j + 1]] = [a[j + 1], a[j]];
  return a;
}

console.log(${f}([5, 1, 4, 2])); // [1, 2, 4, 5]`,
    en: "simple O(n²) sort — fine for learning, use built-in sort in production",
    hi: "simple O(n²) sort — seekhne ke liye theek, production me built-in sort use karo",
  },
  {
    re: /valid.*email|email.*valid/i, fn: "is_valid_email",
    py: (f) => `import re

def ${f}(email):
    return bool(re.match(r"^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$", email))

print(${f}("test@example.com"))  # True`,
    js: (f) => `function ${f}(email) {
  return /^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$/.test(email);
}

console.log(${f}("test@example.com")); // true`,
    en: "a practical regex check (full RFC validation is far more complex)",
    hi: "practical regex check (poora RFC validation bahut complex hota hai)",
  },
  {
    re: /calculator/i, fn: "calculator",
    py: (f) => `def ${f}(a, op, b):
    ops = {"+": a + b, "-": a - b, "*": a * b, "/": a / b if b else float("nan")}
    return ops.get(op, "unknown operator")

print(${f}(6, "*", 7))  # 42`,
    js: (f) => `function ${f}(a, op, b) {
  const ops = { "+": a + b, "-": a - b, "*": a * b, "/": b ? a / b : NaN };
  return op in ops ? ops[op] : "unknown operator";
}

console.log(${f}(6, "*", 7)); // 42`,
    en: "a tiny 4-operation calculator",
    hi: "chhota 4-operation calculator",
  },
  {
    re: /fetch|api call|http request|get request/i, fn: "fetch_data",
    py: (f) => `import urllib.request, json

def ${f}(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())

data = ${f}("https://api.github.com/repos/python/cpython")
print(data["stargazers_count"])`,
    js: (f) => `async function ${f}(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

${f}("https://api.github.com/repos/python/cpython").then(d => console.log(d.stargazers_count));`,
    en: "fetches a URL and parses the JSON response",
    hi: "URL fetch karke JSON parse karta hai",
  },
  {
    re: /todo (app|list)/i, fn: "todo",
    html: () => `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:400px;margin:40px auto">
  <h2>My Todo</h2>
  <input id="t" placeholder="New task"> <button onclick="add()">Add</button>
  <ul id="list"></ul>
  <script>
    function add() {
      const v = document.getElementById('t').value.trim();
      if (!v) return;
      const li = document.createElement('li');
      li.textContent = v + ' ';
      const del = document.createElement('button');
      del.textContent = 'x';
      del.onclick = () => li.remove();
      li.appendChild(del);
      document.getElementById('list').appendChild(li);
      document.getElementById('t').value = '';
    }
  </script>
</body>
</html>`,
    en: "a complete single-file todo app — save as todo.html and open in a browser",
    hi: "poora single-file todo app — todo.html naam se save karke browser me kholo",
  },
  {
    re: /login (form|page)|signup form/i, fn: "login",
    html: () => `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;display:flex;justify-content:center;margin-top:60px">
  <form onsubmit="event.preventDefault(); check()" style="display:flex;flex-direction:column;gap:10px;width:260px">
    <h2>Login</h2>
    <input id="u" placeholder="Username" required>
    <input id="p" type="password" placeholder="Password" required minlength="6">
    <button>Sign in</button>
    <p id="msg"></p>
  </form>
  <script>
    function check() {
      const u = document.getElementById('u').value;
      document.getElementById('msg').textContent = 'Welcome, ' + u + '! (hook this to your backend)';
    }
  </script>
</body>
</html>`,
    en: "a clean login form with basic validation — connect `check()` to your backend",
    hi: "basic validation ke saath login form — `check()` ko apne backend se jodo",
  },
];

const CODE_INTENT_RE = /\b(write|make|create|generate|build|implement|show me|give me|code|program|function|script|how to|banao|bana do|banado|bana|likho|likh do|likhdo|kaise (banate|likhte|kare)|ka code)\b/i;

export function tryCodeGen(prompt) {
  const hasIntent = CODE_INTENT_RE.test(prompt);
  const tpl = TEMPLATES.find((t) => t.re.test(prompt));
  if (!tpl || !hasIntent) return null;

  const hindi = isHindi(prompt);
  let lang = detectLang(prompt);
  const name = fnName(prompt, tpl.fn);

  let code, usedLang, note = "";
  if (tpl.html && (lang === "html" || (!tpl.py && !tpl.js))) {
    code = tpl.html(); usedLang = "html";
  } else if (lang === "javascript" && tpl.js) {
    code = tpl.js(name); usedLang = "javascript";
  } else if ((lang === "python" || lang === null) && tpl.py) {
    code = tpl.py(name); usedLang = "python";
  } else if (tpl.js) {
    code = tpl.js(name); usedLang = "javascript";
    if (lang && !["javascript", "python", "html"].includes(lang))
      note = hindi
        ? `\n\n_Maine JavaScript me diya hai; ${lang} version ke liye 🧩 Real Brain load karo (sidebar) — wo har language likh sakta hai._`
        : `\n\n_Shown in JavaScript; for a ${lang} version load the 🧩 Real Brain (sidebar) — it writes any language._`;
  } else if (tpl.html) {
    code = tpl.html(); usedLang = "html";
  } else {
    return null;
  }
  if (lang && !["javascript", "python", "html"].includes(lang) && !note && usedLang === "python")
    note = hindi
      ? `\n\n_Maine Python me diya hai; ${lang} version ke liye 🧩 Real Brain load karo (sidebar)._`
      : `\n\n_Shown in Python; for ${lang} load the 🧩 Real Brain (sidebar)._`;

  const intro = hindi ? `Ye raha aapka code (${usedLang}):` : `Here's your code (${usedLang}):`;
  const explain = hindi ? `**Kaise kaam karta hai:** ${tpl.hi}` : `**How it works:** ${tpl.en}`;
  return `${intro}\n\n\`\`\`${usedLang}\n${code}\n\`\`\`\n\n${explain}${note}`;
}

// Honest fallback when a code request matches no template.
export function codeFallback(prompt) {
  if (!CODE_INTENT_RE.test(prompt)) return null;
  const hindi = isHindi(prompt);
  return hindi
    ? "Ye specific code mere templates me nahi hai. **Best option:** sidebar me 🧩 **Real Brain** select karo — ek asli LLM (Llama/Qwen) aapke browser me hi chalega, bina API ke, aur ye kisi bhi tarah ka code likh dega. Ya 'Teach from URL' se mujhe iske baare me sikha do."
    : "That exact code isn't in my templates yet. **Best option:** pick the 🧩 **Real Brain** in the sidebar — a real LLM (Llama/Qwen) runs inside your browser, no API, and it can write any code. Or teach me about it via 'Teach from URL'.";
}
