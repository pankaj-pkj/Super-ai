<?php
// backend/cron/learn.php — the always-on brain.
// Set a cPanel cron job to run this every few minutes. It learns even when
// NOBODY has the website open — that's what a real server gives you.
//
// cPanel → Cron Jobs → add (every 5 min):
//   /usr/local/bin/php /home/USER/public_html/backend/cron/learn.php >/dev/null 2>&1
//
// Each run does a small amount of work (polite to rate limits + shared hosting).

require __DIR__ . '/../lib.php';

$db = db();
$now = time();
$did = [];

// ---- 1) Resolve one thing a user asked that we didn't know ----
$c = $db->query('SELECT id, topic FROM curiosity WHERE resolved=0 ORDER BY id ASC LIMIT 1')->fetch();
if ($c) {
  $title = ucwords(str_replace(' ', '_', $c['topic']));
  $wiki = http_get('https://en.wikipedia.org/api/rest_v1/page/summary/' . rawurlencode($title));
  if ($wiki) {
    $j = json_decode($wiki, true);
    if (!empty($j['extract']) && strlen($j['extract']) > 120) {
      learn($db, ($j['content_urls']['desktop']['page'] ?? 'wiki:' . $c['topic']),
            'web', 'Wikipedia: ' . ($j['title'] ?? $c['topic']), 'text', '', $j['extract']);
      $did[] = "curiosity: {$c['topic']}";
    }
  }
  $db->prepare('UPDATE curiosity SET resolved=1 WHERE id=?')->execute([$c['id']]);
}

// ---- 2) Learn a trending / popular repo README from GitHub ----
$langs = ['python','javascript','typescript','go','rust','java','c++','php','ruby','kotlin'];
$lang = $langs[array_rand($langs)];
$search = http_get('https://api.github.com/search/repositories?q=language:' .
                   rawurlencode($lang) . '&sort=stars&order=desc&per_page=5');
if ($search) {
  $items = json_decode($search, true)['items'] ?? [];
  foreach ($items as $repo) {
    $full = $repo['full_name'];
    foreach (['main', 'master'] as $branch) {
      $url = "https://raw.githubusercontent.com/$full/$branch/README.md";
      if (already_have($db, $url)) break;
      $body = http_get($url);
      if ($body) {
        learn($db, $url, 'github', "GitHub: $full", 'code', $lang, mb_substr($body, 0, 12000));
        $did[] = "github: $full";
        break 2; // one repo per run
      }
    }
  }
}

// ---- 3) Learn a language reference page from the web ----
$refs = [
  'https://raw.githubusercontent.com/python/cpython/main/README.rst',
  'https://raw.githubusercontent.com/nodejs/node/main/README.md',
  'https://raw.githubusercontent.com/rust-lang/rust/master/README.md',
];
$ref = $refs[array_rand($refs)];
if (!already_have($db, $ref)) {
  $body = http_get($ref);
  if ($body) { learn($db, $ref, 'web', basename($ref), 'text', '', mb_substr($body, 0, 12000)); $did[] = 'ref: ' . basename($ref); }
}

echo '[' . gmdate('c') . "] learned: " . (count($did) ? implode(', ', $did) : 'nothing new') . "\n";

// ---------- helpers ----------
function already_have($db, $url) {
  $s = $db->prepare('SELECT 1 FROM knowledge WHERE source=? LIMIT 1');
  $s->execute([$url]);
  return (bool)$s->fetchColumn();
}
function learn($db, $source, $type, $title, $kind, $lang, $body) {
  $db->prepare('INSERT IGNORE INTO knowledge (source, source_type, title, kind, lang, body, created_at)
                VALUES (?,?,?,?,?,?,?)')
     ->execute([$source, $type, $title, $kind, $lang, trim($body), time()]);
}
