<?php
// GET /api/realtime.php?q=...  — realtime answer for general questions.
// Searches Wikipedia (no API key needed), returns a fresh summary, and stores
// it in the knowledge base so the answer is instant next time. Extend this with
// a search API later for full web coverage.
require __DIR__ . '/../lib.php';
cors();

$q = trim($_GET['q'] ?? (body()['q'] ?? ''));
if ($q === '') out(['ok' => false, 'error' => 'q required'], 400);

// 1) find the best matching Wikipedia article
$search = http_get('https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=' . urlencode($q));
$title = null;
if ($search) {
  $j = json_decode($search, true);
  if (!empty($j[1][0])) $title = $j[1][0];
}
if (!$title) out(['ok' => true, 'answer' => null]);

// 2) fetch its summary
$sum = http_get('https://en.wikipedia.org/api/rest_v1/page/summary/' . rawurlencode(str_replace(' ', '_', $title)));
$extract = null; $url = null;
if ($sum) {
  $s = json_decode($sum, true);
  $extract = $s['extract'] ?? null;
  $url = $s['content_urls']['desktop']['page'] ?? null;
}
if (!$extract) out(['ok' => true, 'answer' => null]);

// 3) cache into the knowledge base for next time
db()->prepare('INSERT IGNORE INTO knowledge (source, source_type, title, kind, lang, body, created_at)
               VALUES (?,?,?,?,?,?,?)')
    ->execute([$url ?: "wiki:$title", 'web', "Wikipedia: $title", 'text', '', $extract, time()]);

out(['ok' => true, 'answer' => $extract, 'source' => $url, 'title' => $title]);
