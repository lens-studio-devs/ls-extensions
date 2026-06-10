# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

# Installed via Runtime.evaluate at attach time and re-installed on
# executionContextCreated. Idempotent: returns "already" on the second call so
# re-arm during a flurry of context events doesn't double-bind the listener.
PROBE_INSTALL_JS = """
(function () {
  if (globalThis.__lsdbg_probe_installed) return globalThis.__lsdbg_probe_kind || "already";
  globalThis.__lsdbg_probe_installed = true;
  globalThis.__lsdbg_frame_count = 0;
  globalThis.__lsdbg_last_frame_ms = Date.now();
  try {
    if (typeof script !== "undefined" && script && script.createEvent) {
      var ev = script.createEvent("UpdateEvent");
      ev.bind(function () {
        globalThis.__lsdbg_frame_count = (globalThis.__lsdbg_frame_count || 0) + 1;
        globalThis.__lsdbg_last_frame_ms = Date.now();
      });
      globalThis.__lsdbg_probe_kind = "updateEvent";
      return "updateEvent";
    }
  } catch (e) {
    globalThis.__lsdbg_probe_kind = "error:" + ((e && e.message) || String(e));
    return globalThis.__lsdbg_probe_kind;
  }
  globalThis.__lsdbg_probe_kind = "unsupported";
  return "unsupported";
})()
"""

# Polled by `_handle_health`. Returns the counter, last-frame ms (lens clock),
# the lens's "now" (so frame_age_ms is symmetric with the lens clock — no
# host/lens skew), and the install-time `kind` flag.
PROBE_READ_JS = """
({
  c: globalThis.__lsdbg_frame_count,
  t: globalThis.__lsdbg_last_frame_ms,
  now: Date.now(),
  kind: globalThis.__lsdbg_probe_kind || null,
})
"""

# A frame within this window of the lens's "now" counts as "still ticking".
# 1s is generous — even a stuttering 1 fps preview reports playing: true; a
# stopped preview always reports false within ~1s of the next health call.
FRAME_FRESHNESS_MS = 1000

# Cap for the probe-install Runtime.evaluate. On LS Internal v5.22+ that eval
# can stall indefinitely behind a busy JS main loop; without this cap the
# entire attach blocks on a hung probe. The synthetic -32001 ("Command timed
# out") envelope from `CdpClient` is handled by `_install_frame_probe`'s
# existing error branch — install ends up unsupported, but the daemon stays
# responsive and `health` falls back to `vm_activity_age_ms`.
PROBE_INSTALL_TIMEOUT_S = 3.0


# Fallback "is the JS thread alive?" ping used by `health` when the frame-tick
# probe failed to install. A bare `Date.now()` eval is the cheapest expression
# Hermes can answer and round-trips entirely off the lens render thread, so a
# timely reply proves the VM is processing CDP commands even when
# `script.createEvent` is unavailable (LS Internal v5.22+). Distinct from the
# probe-install timeout because this runs on every `health` call, not once at
# attach.
VM_RESPONSIVE_PROBE_JS = "Date.now()"
VM_RESPONSIVE_TIMEOUT_S = 2.0
