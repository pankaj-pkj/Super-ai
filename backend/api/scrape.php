<?php
// GET/POST /api/scrape.php?url=...  — server-side fetch for realtime answers.
// Runs on your server, so it bypasses browser CORS and can read any public page.
// Results are cached so repeated questions are instant.
require __DIR__ . '/../lib.php';
cors();

$url = $_GET['url'] ?? (body()['url'] ?? '');
if (!preg_match('#^https?://#', $url)) out(['ok' => false, 'error' => 'valid url required'], 400);

$hash = sha1($url);
$db = db();
$row = $db->prepare('SELECT content, fetched_at FROM scrape_cache WHERE url_hash=?');
$row->execute([$hash]);
$cached = $row->fetch();
if ($cached && (time() - (int)$cached['fetched_at'] < 86400)) {
  out(['ok' => true, 'cached' => true, 'content' => $cached['content']]);
}

$html = http_get($url);
if ($html === null) out(['ok' => false, 'error' => 'fetch failed'], 502);
$isRaw = strpos($url, 'raw.githubusercontent.com') !== false || strncmp(ltrim($html), '<', 1) !== 0;
$text = $isRaw ? $html : strip_html($html);
$text = mb_substr($text, 0, 12000);

$db->prepare(
  'INSERT INTO scrape_cache (url_hash, url, content, fetched_at) VALUES (?,?,?,?)
   ON DUPLICATE KEY UPDATE content=VALUES(content), fetched_at=VALUES(fetched_at)'
)->execute([$hash, $url, $text, time()]);

out(['ok' => true, 'cached' => false, 'content' => $text]);
