<?php
// POST /api/auth.php  — email or Google sign-in with real server-side verification.
require __DIR__ . '/../lib.php';
cors();

$in = body();
$mode = $in['mode'] ?? 'email';
$c = cfg();

if ($mode === 'google') {
  // Verify the Google ID token server-side (real verification, no trust in client).
  $token = $in['credential'] ?? '';
  if (!$token) out(['ok' => false, 'error' => 'missing credential'], 400);
  $info = http_get('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($token));
  $p = $info ? json_decode($info, true) : null;
  if (!$p || empty($p['email'])) out(['ok' => false, 'error' => 'invalid Google token'], 401);
  if (!empty($c['google_client_id']) && ($p['aud'] ?? '') !== $c['google_client_id'])
    out(['ok' => false, 'error' => 'token audience mismatch'], 401);
  $email = strtolower($p['email']);
  $name  = $p['name'] ?? $email;
  $pic   = $p['picture'] ?? null;
  $verified = ($p['email_verified'] ?? 'false') === 'true' ? 1 : 0;
  $provider = 'google';
} else {
  $email = strtolower(trim($in['email'] ?? ''));
  $name  = trim($in['name'] ?? '');
  if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($name) < 2)
    out(['ok' => false, 'error' => 'valid name and email required'], 400);
  $pic = null; $verified = 0; $provider = 'email';
}

$now = time();
$db = db();
$db->prepare(
  'INSERT INTO users (email, name, provider, picture, verified, created_at)
   VALUES (?,?,?,?,?,?)
   ON DUPLICATE KEY UPDATE name=VALUES(name), picture=VALUES(picture), verified=VALUES(verified)'
)->execute([$email, $name, $provider, $pic, $verified, $now]);

$id = (int)$db->query('SELECT id FROM users WHERE email=' . $db->quote($email))->fetchColumn();
out(['ok' => true, 'user' => [
  'id' => $id, 'name' => $name, 'email' => $email,
  'picture' => $pic, 'provider' => $provider, 'verified' => $verified,
]]);
