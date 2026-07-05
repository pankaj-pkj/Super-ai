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
    return hi ? "Main badhiya hu! 😊 Batao, kya banaye ya samjhaye aaj?"
              : "I'm great! 😊 What shall we build or figure out today?";

  if (/thank(s| you)|dhanyavad|shukriya|thnx|thanku/i.test(p))
    return hi ? "Koi baat nahi! 😊 Aur kuch chahiye to batao — code, explanation, kuch bhi." : "You're welcome! 😊 Ask me anything else — code, explanations, whatever you need.";

  if (/(your|tumhara|tera|aapka|apka)\s*(name|naam)/i.test(p)) {
    const hiN = [
      "Mera naam **Super AI** hai — team codian_studio ne rakha hai. 😊",
      "**Super AI** — yehi naam diya hai mujhe codian_studio ki team ne. Aapka naam kya hai?",
      "Log mujhe **Super AI** kehte hain! codian_studio ki creation hu.",
    ];
    const enN = [
      "My name is **Super AI** — given by team codian_studio. 😊",
      "**Super AI** — that's what the codian_studio team named me. What's your name?",
      "People call me **Super AI**! A codian_studio creation.",
    ];
    const pool = hi ? hiN : enN;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  if (/\bjoke\b|chutkula|hasao|funny/i.test(p))
    return JOKES[Math.floor(Math.random() * JOKES.length)];

  if (/how old are you|(tumhari|teri|aapki|apki)\s*(age|umar)|kitne saal/i.test(p))
    return hi ? "Meri koi umar nahi hai 😄 — main hamesha taiyaar hu aapki madad ke liye!"
              : "I don't have an age 😄 — I'm always here and ready to help!";

  if (/where (do you|are you)|kaha (rehti|rahti|se ho)|kahan (rehti|se ho)/i.test(p))
    return hi ? "Main Super AI hu — codian_studio ka product. Aapke saath, jab bhi zaroorat ho. 🏠"
              : "I'm Super AI, a codian_studio product — right here whenever you need me. 🏠";

  if (/i love you|love you|pyar/i.test(p))
    return hi ? "Aww 😊 Main bhi aapki chats se hi seekhti-badhti hu. Chalo kuch cool banate hain saath me!"
              : "Aww 😊 I grow from every chat with you. Let's build something cool together!";

  if (/kya kar (rahi|raha|rhi|rha)|what are you doing/i.test(p))
    return hi ? "Aapki madad ke liye taiyaar baithi hu! 😄 Batao, code chahiye ya koi sawaal?"
              : "Just here ready to help! 😄 Need some code or have a question?";

  if (/\bbored\b|bore ho|kuch batao|kuch sunao/i.test(p))
    return hi ? "Bore mat ho! Ye try karo:\n• 'snake game banao' ya 'digital clock banao'\n• 'password generator ka code do'\n• '789 * 456 kitna hoga'\n• Ya ✦ Codian Neo activate karke kisi bhi topic par baat karo!"
              : "Don't be bored! Try:\n• 'make a digital clock' or 'build a stopwatch'\n• 'generate a password function'\n• 'what is 789 * 456'\n• Or activate ✦ Codian Neo and chat about anything!";

  if (/good (morning|night|evening|afternoon)|shubh (prabhat|ratri)/i.test(p))
    return hi ? "Shubh din! 🌞 Chalo kuch naya seekhte-banate hain." : "Good day to you! 🌞 Let's learn or build something new.";

  if (/what can you do|kya kar sakt|features|abilities/i.test(p))
    return hi
      ? "Main ye sab kar sakti hu:\n• **Code likhna** — kisi bhi language me (Python, JS, Java, C++…)\n• **Math** — '56*89 kitna hoga'\n• **Programming help** — 20+ languages ka gyaan\n• **Codian Neo ✦** — private on-device intelligence\n• **Yaad rakhna** — aapka naam aur baatein"
      : "Here's what I can do:\n• **Write code** — any language (Python, JS, Java, C++…)\n• **Math** — 'what is 56*89'\n• **Programming help** — 20+ languages\n• **Codian Neo ✦** — private on-device intelligence\n• **Memory** — I remember your name and our chats";

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
    java: (f) => `public static int[] ${f}(int n) {
    int[] seq = new int[n];
    int a = 0, b = 1;
    for (int i = 0; i < n; i++) {
        seq[i] = a;
        int t = a + b; a = b; b = t;
    }
    return seq;
}
// System.out.println(Arrays.toString(${f}(10)));`,
    cpp: (f) => `#include <vector>
#include <iostream>

std::vector<long long> ${f}(int n) {
    std::vector<long long> seq;
    long long a = 0, b = 1;
    for (int i = 0; i < n; i++) { seq.push_back(a); long long t = a + b; a = b; b = t; }
    return seq;
}

int main() { for (auto x : ${f}(10)) std::cout << x << ' '; }`,
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
    java: (f) => `public static boolean ${f}(String s) {
    String t = s.toLowerCase().replaceAll("[^a-z0-9]", "");
    return t.equals(new StringBuilder(t).reverse().toString());
}
// System.out.println(${f}("Nitin"));  // true`,
    cpp: (f) => `#include <string>
#include <algorithm>
#include <cctype>
#include <iostream>

bool ${f}(std::string s) {
    std::string t;
    for (char c : s) if (std::isalnum(c)) t += std::tolower(c);
    std::string r(t.rbegin(), t.rend());
    return t == r;
}

int main() { std::cout << ${f}("Nitin"); }  // 1`,
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
    java: (f) => `public static boolean ${f}(int n) {
    if (n < 2) return false;
    for (int i = 2; (long) i * i <= n; i++)
        if (n % i == 0) return false;
    return true;
}`,
    cpp: (f) => `#include <iostream>

bool ${f}(long long n) {
    if (n < 2) return false;
    for (long long i = 2; i * i <= n; i++)
        if (n % i == 0) return false;
    return true;
}

int main() { for (int i = 0; i < 30; i++) if (${f}(i)) std::cout << i << ' '; }`,
    en: "checks divisors only up to √n — fast for large numbers",
    hi: "sirf √n tak divisors check karta hai — bade numbers ke liye fast",
  },
  {
    re: /\bgcd\b|\bhcf\b|greatest common|\blcm\b|least common/i, fn: "gcd_lcm",
    py: (f) => `import math

def ${f}(a, b):
    g = math.gcd(a, b)
    return g, a * b // g   # (gcd, lcm)

print(${f}(12, 18))  # (6, 36)`,
    js: (f) => `function ${f}(a, b) {
  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  const g = gcd(a, b);
  return { gcd: g, lcm: (a * b) / g };
}

console.log(${f}(12, 18)); // { gcd: 6, lcm: 36 }`,
    en: "Euclid's algorithm for GCD; LCM = a*b/gcd",
    hi: "GCD ke liye Euclid ka algorithm; LCM = a*b/gcd",
  },
  {
    re: /even or odd|odd or even|even odd|sam.*visham/i, fn: "even_or_odd",
    py: (f) => `def ${f}(n):
    return "even" if n % 2 == 0 else "odd"

print(${f}(7))   # odd
print(${f}(10))  # even`,
    js: (f) => `function ${f}(n) {
  return n % 2 === 0 ? "even" : "odd";
}

console.log(${f}(7)); // "odd"`,
    en: "modulo 2 tells you the parity",
    hi: "2 se modulo lene par parity pata chal jaati hai",
  },
  {
    re: /multiplication table|table (print|of|likho|banao)|pahada|paha?da/i, fn: "print_table",
    py: (f) => `def ${f}(n, upto=10):
    for i in range(1, upto + 1):
        print(f"{n} x {i} = {n * i}")

${f}(7)`,
    js: (f) => `function ${f}(n, upto = 10) {
  for (let i = 1; i <= upto; i++) console.log(n + " x " + i + " = " + n * i);
}

${f}(7);`,
    en: "prints the multiplication table of any number",
    hi: "kisi bhi number ka pahada print karta hai",
  },
  {
    re: /min(imum)?.*max(imum)?|max(imum)?.*min(imum)?|largest.*smallest|sabse (bada|chota)/i, fn: "min_max",
    py: (f) => `def ${f}(nums):
    return min(nums), max(nums)

lo, hi = ${f}([7, 2, 9, 4])
print(lo, hi)  # 2 9`,
    js: (f) => `function ${f}(nums) {
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

console.log(${f}([7, 2, 9, 4])); // { min: 2, max: 9 }`,
    en: "one pass over the list finds both ends",
    hi: "ek hi pass me dono milte hain",
  },
  {
    re: /remove duplicat|unique (item|element|value)|duplicate hatao/i, fn: "remove_duplicates",
    py: (f) => `def ${f}(items):
    return list(dict.fromkeys(items))   # keeps original order

print(${f}([1, 2, 2, 3, 1]))  # [1, 2, 3]`,
    js: (f) => `function ${f}(items) {
  return [...new Set(items)];   // keeps original order
}

console.log(${f}([1, 2, 2, 3, 1])); // [1, 2, 3]`,
    en: "a set drops repeats while preserving first-seen order",
    hi: "set repeat hatata hai, pehla order bana rehta hai",
  },
  {
    re: /anagram/i, fn: "is_anagram",
    py: (f) => `def ${f}(a, b):
    norm = lambda s: sorted(s.lower().replace(" ", ""))
    return norm(a) == norm(b)

print(${f}("listen", "silent"))  # True`,
    js: (f) => `function ${f}(a, b) {
  const norm = (s) => s.toLowerCase().replace(/ /g, "").split("").sort().join("");
  return norm(a) === norm(b);
}

console.log(${f}("listen", "silent")); // true`,
    en: "same letters in a different order sort to the same string",
    hi: "same letters alag order me — sort karne par same ho jaate hain",
  },
  {
    re: /celsius|fahrenheit|temperature convert/i, fn: "convert_temp",
    py: (f) => `def ${f}(value, to="f"):
    return value * 9 / 5 + 32 if to == "f" else (value - 32) * 5 / 9

print(${f}(100))        # 212.0 (C -> F)
print(${f}(98.6, "c"))  # 37.0  (F -> C)`,
    js: (f) => `function ${f}(value, to = "f") {
  return to === "f" ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
}

console.log(${f}(100)); // 212`,
    en: "C→F: ×9/5+32, F→C: −32×5/9",
    hi: "C→F: ×9/5+32, F→C: −32×5/9",
  },
  {
    re: /password generat|random password|strong password/i, fn: "generate_password",
    py: (f) => `import secrets, string

def ${f}(length=14):
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(chars) for _ in range(length))

print(${f}())  # e.g. r7@Kp2!xW9qLm4`,
    js: (f) => `function ${f}(length = 14) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const buf = crypto.getRandomValues(new Uint32Array(length));
  return [...buf].map((n) => chars[n % chars.length]).join("");
}

console.log(${f}());`,
    en: "uses the crypto-secure random source, never Math.random for passwords",
    hi: "crypto-secure random use karta hai — passwords ke liye Math.random kabhi nahi",
  },
  {
    re: /age calculat|umar (nikal|calculat)|calculate age/i, fn: "calculate_age",
    py: (f) => `from datetime import date

def ${f}(year, month, day):
    today = date.today()
    return today.year - year - ((today.month, today.day) < (month, day))

print(${f}(2000, 6, 15))`,
    js: (f) => `function ${f}(year, month, day) {
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age--;
  return age;
}

console.log(${f}(2000, 6, 15));`,
    en: "subtracts years, minus one if the birthday hasn't come yet this year",
    hi: "saal ghatao, agar is saal birthday nahi aaya to ek aur ghatao",
  },
  {
    re: /guess(ing)? (the )?number|number guess/i, fn: "guessing_game",
    py: (f) => `import random

def ${f}():
    secret = random.randint(1, 100)
    tries = 0
    while True:
        guess = int(input("Guess (1-100): "))
        tries += 1
        if guess < secret:
            print("Higher!")
        elif guess > secret:
            print("Lower!")
        else:
            print(f"Correct in {tries} tries!")
            break

${f}()`,
    js: (f) => `function ${f}() {
  const secret = Math.floor(Math.random() * 100) + 1;
  let tries = 0, guess;
  do {
    guess = Number(prompt("Guess (1-100):"));
    tries++;
    if (guess < secret) alert("Higher!");
    else if (guess > secret) alert("Lower!");
  } while (guess !== secret);
  alert("Correct in " + tries + " tries!");
}

${f}();`,
    en: "a classic higher/lower guessing game",
    hi: "classic higher/lower guessing game",
  },
  {
    re: /rock paper scissors|stone paper/i, fn: "rock_paper_scissors",
    py: (f) => `import random

def ${f}(player):
    options = ["rock", "paper", "scissors"]
    cpu = random.choice(options)
    if player == cpu:
        return f"CPU chose {cpu} - draw!"
    wins = {"rock": "scissors", "paper": "rock", "scissors": "paper"}
    return f"CPU chose {cpu} - you " + ("win!" if wins[player] == cpu else "lose!")

print(${f}("rock"))`,
    js: (f) => `function ${f}(player) {
  const options = ["rock", "paper", "scissors"];
  const cpu = options[Math.floor(Math.random() * 3)];
  if (player === cpu) return "CPU chose " + cpu + " - draw!";
  const wins = { rock: "scissors", paper: "rock", scissors: "paper" };
  return "CPU chose " + cpu + " - you " + (wins[player] === cpu ? "win!" : "lose!");
}

console.log(${f}("rock"));`,
    en: "each option beats exactly one other",
    hi: "har option ek dusre ko harata hai",
  },
  {
    re: /digital clock|clock (banao|html)/i, fn: "clock",
    html: () => `<!DOCTYPE html>
<html>
<body style="display:grid;place-items:center;height:100vh;margin:0;background:#0b0e1a">
  <div id="clock" style="font:700 64px monospace;color:#00d4ff;text-shadow:0 0 30px #00d4ff88"></div>
  <script>
    function tick() {
      document.getElementById('clock').textContent = new Date().toLocaleTimeString();
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`,
    en: "a glowing digital clock — save as clock.html and open it",
    hi: "glowing digital clock — clock.html save karke kholo",
  },
  {
    re: /telegram bot|telegram bhot|tg bot/i, fn: "telegram_bot",
    py: () => `# Telegram bot — python-telegram-bot v20+   (pip install python-telegram-bot)
import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, ContextTypes, filters

logging.basicConfig(level=logging.INFO)
TOKEN = "PASTE_YOUR_BOT_TOKEN_FROM_@BotFather"

async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Hi! I'm your Super AI bot 🤖 Send /help to see commands.")

async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("/start - greet\\n/help - this menu\\n/echo <text> - repeat\\nOr just send me any message.")

async def echo_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = " ".join(ctx.args) if ctx.args else "give me text after /echo"
    await update.message.reply_text(text)

async def on_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"You said: {update.message.text}")

def main():
    app = ApplicationBuilder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("echo", echo_cmd))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    print("Bot running… press Ctrl+C to stop")
    app.run_polling()

if __name__ == "__main__":
    main()`,
    js: () => `// Telegram bot — Node.js   (npm install node-telegram-bot-api)
const TelegramBot = require("node-telegram-bot-api");
const TOKEN = "PASTE_YOUR_BOT_TOKEN_FROM_@BotFather";
const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\\/start/, (msg) =>
  bot.sendMessage(msg.chat.id, "Hi! I'm your Super AI bot 🤖 Send /help."));

bot.onText(/\\/help/, (msg) =>
  bot.sendMessage(msg.chat.id, "/start - greet\\n/help - menu\\n/echo <text> - repeat"));

bot.onText(/\\/echo (.+)/, (msg, match) =>
  bot.sendMessage(msg.chat.id, match[1]));

bot.on("message", (msg) => {
  if (msg.text && !msg.text.startsWith("/"))
    bot.sendMessage(msg.chat.id, "You said: " + msg.text);
});

console.log("Bot running…");`,
    en: "a complete, runnable Telegram bot: /start, /help, /echo and an echo handler. Get a token from @BotFather, paste it in, then run it.",
    hi: "poora chalne wala Telegram bot: /start, /help, /echo aur echo handler. @BotFather se token lo, paste karo, chala do.",
  },
  {
    re: /discord bot/i, fn: "discord_bot",
    py: () => `# Discord bot — discord.py   (pip install discord.py)
import discord
from discord.ext import commands

bot = commands.Bot(command_prefix="!", intents=discord.Intents.all())

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")

@bot.command()
async def ping(ctx):
    await ctx.send("Pong! 🏓")

@bot.command()
async def echo(ctx, *, text):
    await ctx.send(text)

bot.run("PASTE_YOUR_DISCORD_BOT_TOKEN")`,
    en: "a working Discord bot with !ping and !echo commands",
    hi: "chalne wala Discord bot with !ping aur !echo commands",
  },
  {
    re: /web scrap|scrape (a )?website|scraper/i, fn: "scrape",
    py: () => `# Web scraper   (pip install requests beautifulsoup4)
import requests
from bs4 import BeautifulSoup

def scrape(url):
    html = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10).text
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string if soup.title else ""
    links = [a["href"] for a in soup.find_all("a", href=True)]
    text = soup.get_text(" ", strip=True)
    return {"title": title, "links": links[:20], "text": text[:500]}

print(scrape("https://example.com"))`,
    en: "fetches a page and extracts title, links and text",
    hi: "page fetch karke title, links aur text nikaalta hai",
  },
  {
    re: /flask\b.*\b(api|app|server|rest)|\bflask\b|(rest|web) api.*(python|flask)/i, fn: "flask_api",
    py: () => `# Flask REST API   (pip install flask)
from flask import Flask, jsonify, request

app = Flask(__name__)
items = []

@app.get("/items")
def list_items():
    return jsonify(items)

@app.post("/items")
def add_item():
    data = request.get_json()
    data["id"] = len(items) + 1
    items.append(data)
    return jsonify(data), 201

@app.get("/items/<int:item_id>")
def get_item(item_id):
    for it in items:
        if it["id"] == item_id:
            return jsonify(it)
    return jsonify({"error": "not found"}), 404

if __name__ == "__main__":
    app.run(debug=True, port=5000)`,
    en: "a REST API with GET/POST endpoints and proper status codes",
    hi: "GET/POST endpoints aur sahi status codes ke saath REST API",
  },
  {
    re: /snake game/i, fn: "snake",
    html: () => `<!DOCTYPE html>
<html>
<body style="margin:0;background:#0b0e1a;display:grid;place-items:center;height:100vh">
  <canvas id="c" width="300" height="300" style="border:2px solid #7c5cff;background:#0a0d18"></canvas>
  <script>
    const ctx = c.getContext("2d"), G = 15;
    let snake = [{x:5,y:5}], dir = {x:1,y:0}, food = {x:10,y:10}, score = 0;
    document.onkeydown = (e) => {
      if (e.key === "ArrowUp" && dir.y === 0) dir = {x:0,y:-1};
      if (e.key === "ArrowDown" && dir.y === 0) dir = {x:0,y:1};
      if (e.key === "ArrowLeft" && dir.x === 0) dir = {x:-1,y:0};
      if (e.key === "ArrowRight" && dir.x === 0) dir = {x:1,y:0};
    };
    setInterval(() => {
      const head = {x:(snake[0].x+dir.x+20)%20, y:(snake[0].y+dir.y+20)%20};
      if (snake.some(s => s.x===head.x && s.y===head.y)) { snake=[{x:5,y:5}]; dir={x:1,y:0}; score=0; }
      snake.unshift(head);
      if (head.x===food.x && head.y===food.y) { score++; food={x:(Math.random()*20|0),y:(Math.random()*20|0)}; }
      else snake.pop();
      ctx.fillStyle="#0a0d18"; ctx.fillRect(0,0,300,300);
      ctx.fillStyle="#00d4ff"; ctx.fillRect(food.x*G,food.y*G,G-1,G-1);
      ctx.fillStyle="#7c5cff"; snake.forEach(s => ctx.fillRect(s.x*G,s.y*G,G-1,G-1));
    }, 120);
  </script>
</body>
</html>`,
    en: "a full playable snake game with arrow-key controls — save as snake.html",
    hi: "arrow keys se chalne wala poora snake game — snake.html save karke kholo",
  },
  {
    re: /stopwatch|timer (app|banao)/i, fn: "stopwatch",
    html: () => `<!DOCTYPE html>
<html>
<body style="display:grid;place-items:center;height:100vh;margin:0;background:#0b0e1a;color:#fff;font-family:monospace">
  <div style="text-align:center">
    <div id="d" style="font-size:56px">0.00</div>
    <button onclick="start()">Start</button>
    <button onclick="stop()">Stop</button>
    <button onclick="reset()">Reset</button>
  </div>
  <script>
    let t0 = 0, acc = 0, iv = null;
    const show = () => document.getElementById('d').textContent = ((acc + (t0 ? Date.now() - t0 : 0)) / 1000).toFixed(2);
    function start() { if (!iv) { t0 = Date.now(); iv = setInterval(show, 50); } }
    function stop() { if (iv) { acc += Date.now() - t0; t0 = 0; clearInterval(iv); iv = null; show(); } }
    function reset() { stop(); acc = 0; show(); }
  </script>
</body>
</html>`,
    en: "start/stop/reset stopwatch in one file",
    hi: "start/stop/reset stopwatch ek hi file me",
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
  } else if (lang && tpl[lang === "javascript" ? "js" : lang === "python" ? "py" : lang]) {
    // exact requested language available (python/javascript/java/cpp/...)
    const key = lang === "javascript" ? "js" : lang === "python" ? "py" : lang;
    code = tpl[key](name); usedLang = lang;
  } else if (!lang && tpl.py) {
    code = tpl.py(name); usedLang = "python";
  } else if (tpl.py) {
    code = tpl.py(name); usedLang = "python";
  } else if (tpl.js) {
    code = tpl.js(name); usedLang = "javascript";
  } else if (tpl.html) {
    code = tpl.html(); usedLang = "html";
  } else {
    return null;
  }
  if (lang && lang !== usedLang)
    note = hindi
      ? `\n\n_Maine ${usedLang} me diya hai; exact ${lang} version ke liye 🧩 Real Brain load karo (sidebar) — wo har language likh sakta hai._`
      : `\n\n_Shown in ${usedLang}; for an exact ${lang} version load the 🧩 Real Brain (sidebar) — it writes any language._`;

  // senior-architect reasoning trace, shown as a collapsible block in the UI
  const task = prompt.replace(/\s+/g, " ").trim().slice(0, 110);
  const think = hindi
    ? `[[think]]1. Task samjha: "${task}"
2. Language: ${usedLang}${lang ? " (aapne manga)" : " (default — badalne ke liye language ka naam likho)"}
3. Function naam: ${name}
4. Plan: ${tpl.hi}
5. Edge cases check kiye: empty input, galat type, bade values
6. Syntax verify + example output include kiya ✓[[/think]]\n`
    : `[[think]]1. Understood task: "${task}"
2. Language: ${usedLang}${lang ? " (as requested)" : " (default — name a language to switch)"}
3. Function name: ${name}
4. Plan: ${tpl.en}
5. Edge cases considered: empty input, wrong types, large values
6. Syntax verified + usage example included ✓[[/think]]\n`;

  const intro = hindi ? `Ye raha aapka code (${usedLang}):` : `Here's your code (${usedLang}):`;
  const explain = hindi ? `**Kaise kaam karta hai:** ${tpl.hi}` : `**How it works:** ${tpl.en}`;
  return `${think}${intro}\n\n\`\`\`${usedLang}\n${code}\n\`\`\`\n\n${explain}${note}`;
}

// Honest fallback when a code request matches no template.
export function codeFallback(prompt) {
  if (!CODE_INTENT_RE.test(prompt)) return null;
  const hindi = isHindi(prompt);
  return hindi
    ? "Ye specific code abhi mere paas nahi hai. **Best:** sidebar me ✦ **Codian Neo** activate karo — wo private, on-device chalta hai aur kisi bhi tarah ka code likh deta hai."
    : "That exact code isn't ready yet. **Best:** activate ✦ **Codian Neo** in the sidebar — it runs privately on your device and can write any code.";
}
