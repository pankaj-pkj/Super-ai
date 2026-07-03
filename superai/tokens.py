"""Token accounting with daily limits per user.

Every user gets DAILY_LIMIT tokens per day (UTC). Each model charges a
different multiplier (see brain.MODELS). When the budget runs out, chat
is blocked until the daily reset.
"""

import time
from typing import Dict

from .brain import MODELS, approx_tokens

DEFAULT_DAILY_LIMIT = 20000


class TokenBank:
    def __init__(self, state, daily_limit: int = None):
        self.state = state
        stored = state.get("daily_limit")
        self.daily_limit = daily_limit or (int(stored) if stored else DEFAULT_DAILY_LIMIT)
        state.put("daily_limit", str(self.daily_limit))

    @staticmethod
    def today() -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    @staticmethod
    def seconds_to_reset() -> int:
        now = time.gmtime()
        return (23 - now.tm_hour) * 3600 + (59 - now.tm_min) * 60 + (60 - now.tm_sec)

    def cost_of(self, prompt: str, response: str, model: str) -> int:
        mult = MODELS.get(model, MODELS["super-chat"])["cost"]
        return (approx_tokens(prompt) + approx_tokens(response)) * mult

    def estimate_cost(self, prompt: str, model: str) -> int:
        """Pre-check estimate (assumes a response about 3x the prompt)."""
        mult = MODELS.get(model, MODELS["super-chat"])["cost"]
        return approx_tokens(prompt) * 4 * mult

    def can_spend(self, user_id: str, estimated: int) -> bool:
        usage = self.state.get_usage(user_id, self.today())
        return usage["used"] + estimated <= self.daily_limit

    def spend(self, user_id: str, tokens: int):
        self.state.add_usage(user_id, self.today(), tokens)

    def balance(self, user_id: str) -> Dict:
        usage = self.state.get_usage(user_id, self.today())
        remaining = max(0, self.daily_limit - usage["used"])
        return {
            "daily_limit": self.daily_limit,
            "used": usage["used"],
            "remaining": remaining,
            "requests_today": usage["requests"],
            "resets_in_sec": self.seconds_to_reset(),
            "day": self.today(),
        }
