<?php
// Shared helpers: config, DB (PDO), CORS, JSON I/O.

function cfg() {
  static $c = null;
  if ($c === null) {
    $path = __DIR__ . '/config.php';
    $c = file_exists($path) ? require $path : require __DIR__ . '/config.sample.php';
  }
  return $c;
}

function db() {
  static $pdo = null;
  if ($pdo === null) {
    $c = cfg();
    $pdo = new PDO(
      "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
      $c['db_user'], $c['db_pass'],
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
       PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
  }
  return $pdo;
}

function cors() {
  $allowed = cfg()['allowed_origins'];
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
  } elseif ($origin && in_array($origin, $allowed, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
  }
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, X-Super-User');
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}

function body() {
  $raw = file_get_contents('php://input');
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data);
  exit;
}

function today_utc() { return gmdate('Y-m-d'); }

// Strip HTML down to readable text (for scrapes).
function strip_html($html) {
  $html = preg_replace('#<script[^>]*>.*?</script>#is', ' ', $html);
  $html = preg_replace('#<style[^>]*>.*?</style>#is', ' ', $html);
  $text = strip_tags($html);
  $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
  return trim(preg_replace('/\s+/', ' ', $text));
}

function http_get($url, $timeout = 15) {
  $c = cfg();
  $headers = ['User-Agent: SuperAI-codian_studio/1.0'];
  if (strpos($url, 'api.github.com') !== false && !empty($c['github_token'])) {
    $headers[] = 'Authorization: Bearer ' . $c['github_token'];
  }
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_SSL_VERIFYPEER => true,
  ]);
  $res = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ($code >= 200 && $code < 300) ? $res : null;
}
