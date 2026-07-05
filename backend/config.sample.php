<?php
// Copy this file to config.php and fill in your cPanel details.
// config.php is git-ignored so your secrets never get committed.

return [
  // cPanel → MySQL Databases (they get a username_ prefix)
  'db_host' => 'localhost',
  'db_name' => 'cpaneluser_superai',
  'db_user' => 'cpaneluser_superai',
  'db_pass' => 'YOUR_DB_PASSWORD',

  // Google OAuth Client ID (same one you put in the front-end config.js).
  // Leave blank to allow email/guest login only.
  'google_client_id' => '',

  // Per-user daily credit limit.
  'daily_limit' => 20000,

  // Allow your GitHub Pages / cPanel domain to call this API.
  // Use '*' while testing, then lock to your real origin(s).
  'allowed_origins' => ['*'],

  // Optional: a GitHub token raises the crawler's rate limit (5000/hr vs 60/hr).
  // Create a classic token with NO scopes at github.com/settings/tokens
  'github_token' => '',

  // Optional: plug in a hosted LLM for truly powerful answers (see HOSTING.md).
  // Groq offers a generous free tier with Llama models. Leave blank to stay
  // fully local (browser Codian Neo + knowledge base).
  'llm_api_url'  => '',   // e.g. https://api.groq.com/openai/v1/chat/completions
  'llm_api_key'  => '',
  'llm_model'    => 'llama-3.3-70b-versatile',
];
