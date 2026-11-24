"""
crowd_state.py - FR-02 crowd rule with hysteresis and hold times.

The raw count flickers from frame to frame, so the CROWDED/NORMAL state only
changes when the new condition has lasted long enough:
  NORMAL  -> CROWDED  when count > limit                    for CROWD_ENTER_HOLD_S seconds
  CROWDED -> NORMAL   when count <= limit - CROWD_EXIT_MARGIN for CROWD_EXIT_HOLD_S seconds
Counts in between (e.g. exactly the limit) keep the current state.
Dips shorter than CROWD_GRACE_S (one-frame detection drop-outs) do not restart the timer.
"""

import time

import config


class CrowdState:
    def __init__(self, enter_hold_s=config.CROWD_ENTER_HOLD_S,
                 exit_hold_s=config.CROWD_EXIT_HOLD_S,
                 exit_margin=config.CROWD_EXIT_MARGIN,
                 grace_s=config.CROWD_GRACE_S):
        self.enter_hold_s = enter_hold_s
        self.exit_hold_s = exit_hold_s
        self.exit_margin = exit_margin
        self.grace_s = grace_s
        self.crowded = False
        self._pending_since = None   # when the condition for switching started
        self._last_seen = None       # last time the condition was true

    def update(self, count: int, limit: int, now: float = None) -> bool:
        """Feed one count. Returns True if the state changed on this call."""
        now = time.monotonic() if now is None else now
        if self.crowded:
            wants_switch = count <= limit - self.exit_margin
            hold = self.exit_hold_s
        else:
            wants_switch = count > limit
            hold = self.enter_hold_s

        if not wants_switch:
            # A short dip (one bad frame) is ignored; a real break restarts the timer
            if self._last_seen is None or now - self._last_seen > self.grace_s:
                self._pending_since = None
            return False
        self._last_seen = now
        if self._pending_since is None:
            self._pending_since = now
        if now - self._pending_since >= hold:
            self.crowded = not self.crowded
            self._pending_since = None
            self._last_seen = None
            return True
        return False

    def seconds_to_switch(self, now: float = None):
        """Seconds left before the state changes, or None if no change is pending."""
        if self._pending_since is None:
            return None
        now = time.monotonic() if now is None else now
        hold = self.exit_hold_s if self.crowded else self.enter_hold_s
        return max(0.0, hold - (now - self._pending_since))
