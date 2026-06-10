# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations


class URLResolveError(Exception):
    pass


class URLNotFound(URLResolveError):
    pass


class AmbiguousURL(URLResolveError):
    def __init__(self, query: str, candidates: list[str]) -> None:
        super().__init__(query)
        self.query = query
        self.candidates = candidates


def resolve_url(query: str, parsed_urls: list[str]) -> str:
    matches: list[str] = []
    for full in parsed_urls:
        if full == query:
            return full  # exact match wins
        if len(full) >= len(query):
            pos = len(full) - len(query)
            if full.endswith(query) and (pos == 0 or full[pos - 1] == "/"):
                matches.append(full)

    if not matches:
        raise URLNotFound(query)
    if len(matches) > 1:
        raise AmbiguousURL(query, matches)
    return matches[0]
