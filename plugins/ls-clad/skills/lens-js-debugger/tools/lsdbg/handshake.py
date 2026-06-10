# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from .cdp_client import CdpClient


@dataclass
class HandshakeResult:
    ok: bool
    browser_session_id: str
    page_session_id: str
    error_message: str


@dataclass
class BrowserBringUpResult:
    ok: bool
    browser_session_id: str
    error_message: str


@dataclass
class AttachTargetResult:
    ok: bool
    page_session_id: str
    error_message: str


@dataclass
class DetachTargetResult:
    ok: bool
    error_message: str


DEFAULT_HANDSHAKE_TIMEOUT_S = 1000.0  # very generous — matches the C++ 1000000 ms.
DEFAULT_ENABLE_TIMEOUT_S = 10.0
ENABLE_RETRY_SLEEP_S = 0.5


async def bring_up_browser_session(
    client: CdpClient,
    timeout_s: float = DEFAULT_HANDSHAKE_TIMEOUT_S,
) -> BrowserBringUpResult:
    resp = await client.send_command("Target.attachToBrowserTarget", timeout_s=timeout_s)
    if "error" in resp:
        return BrowserBringUpResult(
            ok=False,
            browser_session_id="",
            error_message=resp["error"].get("message", "attachToBrowserTarget failed"),
        )
    browser_session_id = (resp.get("result") or {}).get("sessionId", "")
    if not browser_session_id:
        return BrowserBringUpResult(False, "", "No browserSessionId received")

    resp = await client.send_command(
        "Target.setDiscoverTargets",
        params={"discover": True},
        session_id=browser_session_id,
        timeout_s=timeout_s,
    )
    if "error" in resp:
        msg = resp["error"].get("message", "unknown error")
        return BrowserBringUpResult(
            ok=False,
            browser_session_id=browser_session_id,
            error_message=f"setDiscoverTargets failed: {msg}",
        )
    return BrowserBringUpResult(True, browser_session_id, "")


async def attach_target(
    client: CdpClient,
    browser_session_id: str,
    target_id: str,
    timeout_s: float = DEFAULT_HANDSHAKE_TIMEOUT_S,
) -> AttachTargetResult:
    resp = await client.send_command(
        "Target.attachToTarget",
        params={"targetId": target_id, "flatten": True},
        session_id=browser_session_id,
        timeout_s=timeout_s,
    )
    if "error" in resp:
        msg = resp["error"].get("message", "unknown error")
        return AttachTargetResult(
            ok=False,
            page_session_id="",
            error_message=f"attachToTarget failed for target '{target_id}': {msg}",
        )
    page_session_id = (resp.get("result") or {}).get("sessionId", "")
    if not page_session_id:
        return AttachTargetResult(
            ok=False,
            page_session_id="",
            error_message=f"attachToTarget for target '{target_id}': unexpected response",
        )
    return AttachTargetResult(True, page_session_id, "")


async def detach_target(
    client: CdpClient,
    browser_session_id: str,
    page_session_id: str,
    timeout_s: float = DEFAULT_HANDSHAKE_TIMEOUT_S,
) -> DetachTargetResult:
    resp = await client.send_command(
        "Target.detachFromTarget",
        params={"sessionId": page_session_id},
        session_id=browser_session_id,
        timeout_s=timeout_s,
    )
    if "error" in resp:
        msg = resp["error"].get("message", "unknown error")
        return DetachTargetResult(False, f"detachFromTarget failed: {msg}")
    return DetachTargetResult(True, "")


async def perform_handshake(
    client: CdpClient,
    target_id: str,
    timeout_s: float = DEFAULT_HANDSHAKE_TIMEOUT_S,
) -> HandshakeResult:
    bring_up = await bring_up_browser_session(client, timeout_s=timeout_s)
    if not bring_up.ok:
        return HandshakeResult(False, bring_up.browser_session_id, "", bring_up.error_message)

    attach = await attach_target(client, bring_up.browser_session_id, target_id, timeout_s=timeout_s)
    if not attach.ok:
        return HandshakeResult(False, bring_up.browser_session_id, "", attach.error_message)

    return HandshakeResult(True, bring_up.browser_session_id, attach.page_session_id, "")


@dataclass
class EnableDomainsResult:
    ok: bool
    error_message: str


async def _try_enable_domains(client: CdpClient, session_id: str, timeout_s: float) -> EnableDomainsResult:
    runtime_resp, debugger_resp = await asyncio.gather(
        client.send_command("Runtime.enable", session_id=session_id, timeout_s=timeout_s),
        client.send_command("Debugger.enable", session_id=session_id, timeout_s=timeout_s),
    )
    if "error" in runtime_resp:
        return EnableDomainsResult(False, f"Runtime.enable: {runtime_resp['error'].get('message', 'unknown error')}")
    if "error" in debugger_resp:
        return EnableDomainsResult(False, f"Debugger.enable: {debugger_resp['error'].get('message', 'unknown error')}")

    # Auto-enable pause on uncaught exceptions so silently-dying scripts
    # surface in the agent's view. Fire-and-forget — failures aren't fatal.
    await client.send_command(
        "Debugger.setPauseOnExceptions",
        params={"state": "uncaught"},
        session_id=session_id,
        timeout_s=timeout_s,
    )
    return EnableDomainsResult(True, "")


async def enable_domains(
    client: CdpClient,
    session_id: str,
    timeout_s: float = DEFAULT_ENABLE_TIMEOUT_S,
) -> EnableDomainsResult:
    result = await _try_enable_domains(client, session_id, timeout_s)
    if result.ok:
        return result

    # The preview-side debug session is constructed asynchronously — give it
    # a moment and retry once. Stop if the WebSocket has dropped meanwhile.
    await asyncio.sleep(ENABLE_RETRY_SLEEP_S)
    if not client.is_connected:
        return EnableDomainsResult(False, f"WebSocket disconnected before retry: {result.error_message}")
    return await _try_enable_domains(client, session_id, timeout_s)
