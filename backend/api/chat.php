<?php
// POST /api/chat.php — logs a chat, enforces daily credits, and (optionally)
// answers with a hosted LLM + the server knowledge base. If no LLM is
// configured it returns the best knowledge-base match; the front-end still has
// its own on-device brain, so this endpoint is an enhancement, not a hard dep.
require __DIR__ . '/../lib.php';
cors();

$in = body();
$userId  = (int)($in['user_id'] ?? 0);
$model   = $in['model'] ?? 'super-chat';
$prompt  = trim($in['message'] ?? '');
$session = $in['session'] ?? 'default';
if ($userId <= 0 || $prompt === '') out(['ok' => false, 'error' => 'user_id and message required'], 400);

$c = cfg();
$db = db();

// daily credit check
$day = today_utc();
$u = $db->prepare('SELECT used FROM usage_daily WHERE user_id=? AND day=?');
$u->execute([$userId, $day]);
$used = (int)($u->fetchColumn() ?: 0);
if ($used >= $c['daily_limit']) out(['ok' => false, 'limit_hit' => true, 'error' => 'daily limit reached'], 429);

// --- build an answer ---
$answer = null;

if (!empty($c['llm_api_url']) && !empty($c['llm_api_key'])) {
  // Pull a little relevant context from the knowledge base (RAG).
  $ctx = '';
  $q = $db->prepare('SELECT title, body FROM knowledge
                     WHERE MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE) LIMIT 4');
  $q->execute([$prompt]);
  foreach ($q->fetchAll() as $r) $ctx .= "- {$r['title']}: " . mb_substr($r['body'], 0, 400) . "\n";

  $payload = json_encode([
    'model' => $c['llm_model'],
    'messages' => [
      ['role' => 'system', 'content' =>
        'You are Super AI, created by team codian_studio. Never mention any other company or base model. ' .
        'You are an expert programmer. Reason step by step for complex tasks. Reply in Hinglish if asked in Hindi.' .
        ($ctx ? "\nRelevant context:\n$ctx" : '')],
      ['role' => 'user', 'content' => $prompt],
    ],
    'temperature' => 0.6,
  ]);
  $ch = curl_init($c['llm_api_url']);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
    CURLOPT_TIMEOUT => 60,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $c['llm_api_key']],
  ]);
  $resp = curl_exec($ch); curl_close($ch);
  $j = json_decode($resp, true);
  $answer = $j['choices'][0]['message']['content'] ?? null;
}

if ($answer === null) {
  // knowledge-base fallback (full-text search)
  $q = $db->prepare('SELECT body FROM knowledge
                     WHERE MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE) LIMIT 1');
  $q->execute([$prompt]);
  $answer = $q->fetchColumn() ?: null;
  if ($answer === false || $answer === null) {
    // remember what we didn't know so the cron learner researches it
    $topic = mb_substr(preg_replace('/[^\p{L}\p{N} ]/u', '', $prompt), 0, 120);
    $db->prepare('INSERT IGNORE INTO curiosity (topic, created_at) VALUES (?,?)')
       ->execute([$topic, time()]);
    $answer = null; // let the client answer with its on-device brain
  }
}

$tokens = (int)ceil((mb_strlen($prompt) + mb_strlen($answer ?? '')) / 4);
$db->prepare('INSERT INTO chats (user_id, session_id, model, prompt, response, tokens, created_at)
              VALUES (?,?,?,?,?,?,?)')
   ->execute([$userId, $session, $model, $prompt, $answer ?? '', $tokens, time()]);
$db->prepare('INSERT INTO usage_daily (user_id, day, used, requests) VALUES (?,?,?,1)
              ON DUPLICATE KEY UPDATE used=used+VALUES(used), requests=requests+1')
   ->execute([$userId, $day, $tokens]);

out([
  'ok' => true,
  'response' => $answer,                 // null => front-end uses its own brain
  'tokens_charged' => $tokens,
  'remaining' => max(0, $c['daily_limit'] - $used - $tokens),
]);
