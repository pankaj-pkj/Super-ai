<?php
// GET /api/knowledge.php?q=...   — search the server knowledge base (realtime).
// Lets the front-end pull answers the always-on learner has gathered.
require __DIR__ . '/../lib.php';
cors();

$q = trim($_GET['q'] ?? (body()['q'] ?? ''));
if ($q === '') out(['ok' => true, 'results' => []]);

$db = db();
$st = $db->prepare(
  'SELECT source, source_type, title, kind, lang, body,
          MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
   FROM knowledge
   WHERE MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE)
   ORDER BY score DESC LIMIT 6'
);
$st->execute([$q, $q]);
$rows = $st->fetchAll();
foreach ($rows as &$r) $r['body'] = mb_substr($r['body'], 0, 1200);

out(['ok' => true, 'count' => count($rows), 'results' => $rows]);
