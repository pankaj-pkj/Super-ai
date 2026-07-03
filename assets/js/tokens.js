// tokens.js — per-user daily token limits, stored in the browser.

import { MODELS } from "./brain.js";
import { approxTokens, todayUTC, secondsToResetUTC } from "./core.js";

export const DEFAULT_DAILY_LIMIT = 20000;

export class TokenBank {
  constructor(store, dailyLimit = null) {
    this.store = store;
    this.dailyLimit = dailyLimit || DEFAULT_DAILY_LIMIT;
  }

  async init() {
    const stored = await this.store.getKV("daily_limit");
    if (stored) this.dailyLimit = parseInt(stored);
    else await this.store.setKV("daily_limit", String(this.dailyLimit));
  }

  costOf(prompt, response, model) {
    const mult = (MODELS[model] || MODELS["super-chat"]).cost;
    return (approxTokens(prompt) + approxTokens(response)) * mult;
  }

  estimateCost(prompt, model) {
    const mult = (MODELS[model] || MODELS["super-chat"]).cost;
    return approxTokens(prompt) * 4 * mult;
  }

  async canSpend(userId, estimated) {
    const u = await this.store.getUsage(userId, todayUTC());
    return u.used + estimated <= this.dailyLimit;
  }

  async spend(userId, tokens) {
    await this.store.addUsage(userId, todayUTC(), tokens);
  }

  async balance(userId) {
    const u = await this.store.getUsage(userId, todayUTC());
    return {
      daily_limit: this.dailyLimit,
      used: u.used,
      remaining: Math.max(0, this.dailyLimit - u.used),
      requests_today: u.requests,
      resets_in_sec: secondsToResetUTC(),
      day: todayUTC(),
    };
  }
}
