// knowledge.js — built-in seed knowledge across many programming languages,
// plus UI i18n strings. This ships inside the app so Super AI can answer real
// code/CS questions immediately, before any web harvesting happens.

// Each entry becomes a learned "document". `q` are trigger phrases, `a` is the
// answer (markdown + code). The brain indexes both for retrieval.

export const LANGUAGES = [
  "Python", "JavaScript", "TypeScript", "Java", "C", "C++", "C#", "Go", "Rust",
  "Ruby", "PHP", "Swift", "Kotlin", "SQL", "HTML", "CSS", "Bash", "R", "Dart",
  "Scala", "Perl", "Haskell", "Lua",
];

export const KB = [
  // ---------------- Python ----------------
  { lang: "Python", title: "Python: reverse a string", q: "python reverse string",
    a: "Reverse a string in Python with slicing:\n```python\ns = 'hello'\nprint(s[::-1])  # 'olleh'\n```\nThe `[::-1]` slice steps backwards over the whole string." },
  { lang: "Python", title: "Python: read a file", q: "python read file open",
    a: "Read a file safely with a context manager:\n```python\nwith open('data.txt', 'r', encoding='utf-8') as f:\n    for line in f:\n        print(line.rstrip())\n```\n`with` auto-closes the file even if an error occurs." },
  { lang: "Python", title: "Python: list comprehension", q: "python list comprehension filter map",
    a: "List comprehensions build lists concisely:\n```python\nsquares = [x*x for x in range(10)]\nevens  = [x for x in range(20) if x % 2 == 0]\n```\nUse a `{}` for set/dict comprehensions." },
  { lang: "Python", title: "Python: sort a dictionary by value", q: "python sort dict dictionary by value",
    a: "Sort a dict by its values:\n```python\nd = {'a': 3, 'b': 1, 'c': 2}\nordered = dict(sorted(d.items(), key=lambda kv: kv[1]))\n# {'b': 1, 'c': 2, 'a': 3}\n```" },
  { lang: "Python", title: "Python: async/await", q: "python async await asyncio concurrency",
    a: "Concurrency with asyncio:\n```python\nimport asyncio\nasync def fetch(n):\n    await asyncio.sleep(1)\n    return n * 2\nasync def main():\n    results = await asyncio.gather(*(fetch(i) for i in range(5)))\n    print(results)\nasyncio.run(main())\n```\n`await` yields control while I/O is pending." },
  { lang: "Python", title: "Python: class and dataclass", q: "python class dataclass object oriented",
    a: "Define data-holding classes with `@dataclass`:\n```python\nfrom dataclasses import dataclass\n@dataclass\nclass Point:\n    x: int\n    y: int\n    def dist(self):\n        return (self.x**2 + self.y**2) ** 0.5\np = Point(3, 4)\nprint(p.dist())  # 5.0\n```" },

  // ---------------- JavaScript ----------------
  { lang: "JavaScript", title: "JavaScript: async/await + fetch", q: "javascript async await fetch promise api",
    a: "Fetch JSON with async/await:\n```javascript\nasync function getUser(id) {\n  const res = await fetch(`/api/users/${id}`);\n  if (!res.ok) throw new Error(res.status);\n  return res.json();\n}\ngetUser(1).then(console.log).catch(console.error);\n```" },
  { lang: "JavaScript", title: "JavaScript: array map/filter/reduce", q: "javascript array map filter reduce",
    a: "Transform arrays functionally:\n```javascript\nconst nums = [1,2,3,4,5];\nconst doubled = nums.map(n => n*2);\nconst evens   = nums.filter(n => n % 2 === 0);\nconst sum     = nums.reduce((a,b) => a+b, 0);\n```" },
  { lang: "JavaScript", title: "JavaScript: debounce a function", q: "javascript debounce throttle events",
    a: "Debounce delays a call until input stops:\n```javascript\nfunction debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\nconst onSearch = debounce(q => console.log('search', q), 300);\n```" },
  { lang: "JavaScript", title: "JavaScript: closures", q: "javascript closure scope lexical",
    a: "A closure captures variables from its outer scope:\n```javascript\nfunction counter() {\n  let n = 0;\n  return () => ++n;\n}\nconst next = counter();\nnext(); next(); // 2\n```\nThe inner function keeps `n` alive after `counter` returns." },
  { lang: "JavaScript", title: "JavaScript: destructuring & spread", q: "javascript destructuring spread rest",
    a: "Destructure and spread:\n```javascript\nconst { name, ...rest } = { name: 'Ada', age: 36, city: 'London' };\nconst merged = { ...rest, active: true };\nconst [first, ...others] = [1,2,3,4];\n```" },

  // ---------------- TypeScript ----------------
  { lang: "TypeScript", title: "TypeScript: generics", q: "typescript generics type generic function",
    a: "Generics keep functions type-safe for any type:\n```typescript\nfunction first<T>(arr: T[]): T | undefined {\n  return arr[0];\n}\nconst x = first<number>([1,2,3]); // number | undefined\n```" },
  { lang: "TypeScript", title: "TypeScript: interfaces vs types", q: "typescript interface type alias",
    a: "Describe object shapes:\n```typescript\ninterface User { id: number; name: string; admin?: boolean }\ntype Point = { x: number; y: number };\nconst u: User = { id: 1, name: 'Sam' };\n```\n`interface` can be merged/extended; `type` can express unions." },

  // ---------------- Java ----------------
  { lang: "Java", title: "Java: HashMap usage", q: "java hashmap map dictionary",
    a: "Key-value storage with HashMap:\n```java\nimport java.util.HashMap;\nMap<String,Integer> ages = new HashMap<>();\nages.put(\"Sam\", 30);\nages.getOrDefault(\"Ada\", 0);\nfor (var e : ages.entrySet())\n    System.out.println(e.getKey()+\"=\"+e.getValue());\n```" },
  { lang: "Java", title: "Java: streams", q: "java stream lambda filter collect",
    a: "Java Streams for pipelines:\n```java\nList<Integer> evens = nums.stream()\n    .filter(n -> n % 2 == 0)\n    .map(n -> n * n)\n    .collect(Collectors.toList());\n```" },
  { lang: "Java", title: "Java: threads", q: "java thread runnable concurrency executor",
    a: "Run work on a thread pool:\n```java\nExecutorService pool = Executors.newFixedThreadPool(4);\npool.submit(() -> System.out.println(\"hello from thread\"));\npool.shutdown();\n```" },

  // ---------------- C / C++ ----------------
  { lang: "C", title: "C: pointers and malloc", q: "c pointer malloc free memory allocation",
    a: "Dynamic memory in C:\n```c\n#include <stdlib.h>\nint *arr = malloc(n * sizeof(int));\nif (!arr) return 1;\nfor (int i = 0; i < n; i++) arr[i] = i;\nfree(arr);  // always free what you malloc\n```" },
  { lang: "C++", title: "C++: vectors and range-for", q: "cpp c++ vector stl range for loop",
    a: "STL vector with a range-based loop:\n```cpp\n#include <vector>\n#include <iostream>\nstd::vector<int> v = {1,2,3};\nv.push_back(4);\nfor (int x : v) std::cout << x << ' ';\n```" },
  { lang: "C++", title: "C++: smart pointers", q: "cpp c++ smart pointer unique_ptr shared_ptr",
    a: "RAII memory with smart pointers:\n```cpp\n#include <memory>\nauto p = std::make_unique<int>(42);\nauto s = std::make_shared<std::string>(\"hi\");\n// freed automatically when out of scope\n```" },

  // ---------------- C# ----------------
  { lang: "C#", title: "C#: LINQ", q: "c# csharp linq query filter select",
    a: "Query collections with LINQ:\n```csharp\nvar evens = numbers.Where(n => n % 2 == 0)\n                   .Select(n => n * n)\n                   .ToList();\n```" },

  // ---------------- Go ----------------
  { lang: "Go", title: "Go: goroutines and channels", q: "go golang goroutine channel concurrency",
    a: "Concurrency the Go way:\n```go\nch := make(chan int)\ngo func() { ch <- 42 }()\nfmt.Println(<-ch) // 42\n```\nGoroutines are cheap; channels synchronize them." },
  { lang: "Go", title: "Go: error handling", q: "go golang error handling err",
    a: "Go returns errors as values:\n```go\nf, err := os.Open(\"data.txt\")\nif err != nil {\n    log.Fatal(err)\n}\ndefer f.Close()\n```" },

  // ---------------- Rust ----------------
  { lang: "Rust", title: "Rust: ownership and borrowing", q: "rust ownership borrow reference lifetime",
    a: "Ownership prevents data races at compile time:\n```rust\nlet s = String::from(\"hi\");\nlet len = calc(&s); // borrow, don't move\nfn calc(s: &String) -> usize { s.len() }\n```\nEach value has one owner; borrows are checked by the compiler." },
  { lang: "Rust", title: "Rust: Result and ?", q: "rust result option error handling match",
    a: "Propagate errors with `?`:\n```rust\nfn read(path: &str) -> Result<String, std::io::Error> {\n    let text = std::fs::read_to_string(path)?;\n    Ok(text)\n}\n```" },

  // ---------------- Ruby / PHP / Swift / Kotlin ----------------
  { lang: "Ruby", title: "Ruby: blocks and each", q: "ruby block each iterator map",
    a: "Iterate with blocks:\n```ruby\n[1,2,3].each { |n| puts n*2 }\nsquares = [1,2,3].map { |n| n*n }\n```" },
  { lang: "PHP", title: "PHP: associative arrays", q: "php array associative foreach",
    a: "Associative arrays and foreach:\n```php\n$ages = ['Sam' => 30, 'Ada' => 36];\nforeach ($ages as $name => $age) {\n    echo \"$name is $age\\n\";\n}\n```" },
  { lang: "Swift", title: "Swift: optionals", q: "swift optional nil if let guard",
    a: "Safely unwrap optionals:\n```swift\nlet name: String? = fetchName()\nif let n = name {\n    print(\"Hi \\(n)\")\n}\nguard let n = name else { return }\n```" },
  { lang: "Kotlin", title: "Kotlin: data classes & null safety", q: "kotlin data class null safety",
    a: "Data classes + null safety:\n```kotlin\ndata class User(val id: Int, val name: String)\nval len = user?.name?.length ?: 0\n```" },

  // ---------------- SQL ----------------
  { lang: "SQL", title: "SQL: JOIN two tables", q: "sql join inner left tables query",
    a: "Combine rows across tables:\n```sql\nSELECT u.name, o.total\nFROM users u\nINNER JOIN orders o ON o.user_id = u.id\nWHERE o.total > 100\nORDER BY o.total DESC;\n```" },
  { lang: "SQL", title: "SQL: GROUP BY and aggregates", q: "sql group by count sum aggregate having",
    a: "Aggregate per group:\n```sql\nSELECT user_id, COUNT(*) AS orders, SUM(total) AS spent\nFROM orders\nGROUP BY user_id\nHAVING SUM(total) > 500;\n```" },

  // ---------------- Web ----------------
  { lang: "HTML", title: "HTML: semantic page skeleton", q: "html semantic structure page skeleton",
    a: "A semantic HTML5 skeleton:\n```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head><meta charset=\"UTF-8\"><title>Page</title></head>\n<body>\n  <header>...</header>\n  <main><article>...</article></main>\n  <footer>...</footer>\n</body>\n</html>\n```" },
  { lang: "CSS", title: "CSS: flexbox centering", q: "css flexbox center align justify layout",
    a: "Center anything with flexbox:\n```css\n.wrap {\n  display: flex;\n  align-items: center;     /* vertical */\n  justify-content: center; /* horizontal */\n  min-height: 100vh;\n}\n```" },
  { lang: "CSS", title: "CSS: grid layout", q: "css grid layout columns responsive",
    a: "Responsive grid:\n```css\n.grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\n  gap: 16px;\n}\n```" },

  // ---------------- Bash / R / others ----------------
  { lang: "Bash", title: "Bash: loop over files", q: "bash shell script loop files for",
    a: "Loop over files in a shell script:\n```bash\nfor f in *.txt; do\n  echo \"processing $f\"\n  wc -l \"$f\"\ndone\n```" },
  { lang: "R", title: "R: data frame basics", q: "r dataframe filter summary statistics",
    a: "Work with data frames in R:\n```r\ndf <- data.frame(x = 1:5, y = c(2,4,6,8,10))\nsummary(df)\nsubset(df, y > 5)\n```" },

  // ---------------- CS concepts ----------------
  { lang: "CS", title: "Big-O complexity", q: "big o notation time complexity algorithm efficiency",
    a: "Big-O describes how runtime grows with input size n:\n- O(1) constant, O(log n) binary search\n- O(n) single loop, O(n log n) good sorts\n- O(n^2) nested loops, O(2^n) exponential\nPrefer lower-order algorithms for large n." },
  { lang: "CS", title: "Recursion & the call stack", q: "recursion base case stack factorial fibonacci",
    a: "Recursion solves a problem via smaller instances of itself. Always define a base case:\n```python\ndef fact(n):\n    if n <= 1: return 1      # base case\n    return n * fact(n - 1)   # recursive step\n```" },
  { lang: "CS", title: "Binary search", q: "binary search sorted array algorithm log n",
    a: "Search a sorted array in O(log n):\n```python\ndef bsearch(a, target):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = (lo+hi)//2\n        if a[mid] == target: return mid\n        if a[mid] < target: lo = mid+1\n        else: hi = mid-1\n    return -1\n```" },
  { lang: "CS", title: "Quicksort", q: "quicksort sorting algorithm divide conquer pivot",
    a: "Quicksort partitions around a pivot:\n```python\ndef quicksort(a):\n    if len(a) <= 1: return a\n    pivot = a[len(a)//2]\n    left  = [x for x in a if x < pivot]\n    mid   = [x for x in a if x == pivot]\n    right = [x for x in a if x > pivot]\n    return quicksort(left) + mid + quicksort(right)\n```\nAverage O(n log n)." },
  { lang: "CS", title: "Hash tables", q: "hash table map dictionary collision o1 lookup",
    a: "Hash tables map keys to buckets via a hash function, giving average O(1) lookup/insert. Collisions are handled by chaining (linked lists) or open addressing (probing). They back dict/map/HashMap/object types in most languages." },
  { lang: "CS", title: "Git basics", q: "git commit branch merge push pull version control",
    a: "Core git workflow:\n```bash\ngit checkout -b feature   # new branch\ngit add -A && git commit -m \"msg\"\ngit push -u origin feature\ngit merge main            # bring in changes\n```" },
  { lang: "CS", title: "REST API design", q: "rest api http get post put delete endpoint json",
    a: "REST maps HTTP verbs to resource actions:\n- GET /users — list, GET /users/1 — read\n- POST /users — create, PUT /users/1 — replace\n- PATCH /users/1 — update, DELETE /users/1 — remove\nReturn JSON and proper status codes (200, 201, 404, 429)." },
  { lang: "CS", title: "What is machine learning", q: "machine learning neural network training model ai",
    a: "Machine learning fits a model's parameters to data so it can predict on new inputs. Neural networks stack layers of weighted sums + nonlinearities, trained by gradient descent that lowers a loss function. Large language models are big neural nets trained to predict the next token." },
];

// UI i18n — English + Hindi
export const I18N = {
  en: {
    tagline: "by codian_studio",
    footer: "Super AI by codian_studio · your coding & answering companion",
    daily: "Daily Tokens", models: "Models — pick per task", stats: "Mind Stats",
    feed: "Self-Improvement Feed", teach: "Teach from URL", train: "Train Neural",
    improve: "Self-Improve Now", placeholder: "Message Super AI… (it learns from you too)",
    welcome: "Welcome to", used: "used", requests: "requests", resets: "resets in",
    docs: "docs learned", sentences: "sentences", evolutions: "evolutions",
    steps: "neural steps", limitHit: "Daily token limit reached — resets at midnight UTC.",
    newchat: "New Chat", history: "Chats",
    autolearn: "Auto-learn 24×7", intro:
      "Your professional coding & answering assistant by codian_studio. Ask a question, " +
      "get instant working code, or activate on-device intelligence for private answers.",
  },
  hi: {
    tagline: "by codian_studio",
    footer: "Super AI by codian_studio · aapka coding & answering saathi",
    daily: "Daily Tokens", models: "Models — kaam ke hisaab se chuno", stats: "Dimaag ke Stats",
    feed: "Self-Improvement Feed", teach: "URL se sikhao", train: "Neural Train karo",
    improve: "Abhi Self-Improve", placeholder: "Super AI ko message karo… (ye aapse bhi seekhta hai)",
    welcome: "Swagat hai", used: "use hua", requests: "requests", resets: "reset hoga",
    docs: "docs seekhe", sentences: "sentences", evolutions: "evolutions",
    steps: "neural steps", limitHit: "Aaj ka token limit khatam — midnight UTC par reset hoga.",
    newchat: "Nayi Chat", history: "Chats",
    autolearn: "Auto-learn 24×7", intro:
      "codian_studio ka professional coding & answering assistant. Sawaal poochho, turant chalne wala " +
      "code lo, ya private jawaabon ke liye on-device intelligence activate karo.",
  },
};
