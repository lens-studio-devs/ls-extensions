# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import time
from typing import Callable, Optional, TypeVar

T = TypeVar("T")


def poll_until(
    predicate: Callable[[], Optional[T]],
    *,
    timeout_ms: int,
    interval_ms: int,
) -> Optional[T]:
    deadline = time.monotonic() + max(0.0, timeout_ms / 1000.0)
    interval_s = max(0.0, interval_ms / 1000.0)
    while True:
        result = predicate()
        if result:
            return result
        if time.monotonic() >= deadline:
            return None
        time.sleep(interval_s)
