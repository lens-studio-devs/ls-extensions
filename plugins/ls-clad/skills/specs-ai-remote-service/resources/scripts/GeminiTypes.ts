// Copyright 2025 Google LLC.
// SPDX-License-Identifier: Apache-2.0

/**
 * Legacy type definitions for Google Gemini API. Maintained for backwards compatibility.
 * New implementations should use GoogleGenAITypes instead.
 *
 * @deprecated Use GoogleGenAITypes instead. This file is maintained for backwards compatibility.
 *
 * Modifications:
 * Rewrote https://github.com/googleapis/js-genai/blob/v0.12.0/src/types.ts with the help of GenAI in order to best support the Gemini API in Lens Studio.
 *
 * Abide by Gemini API Terms of Service while using this code - https://ai.google.dev/gemini-api/terms
 */

// Re-export from the new unified GoogleGenAI namespace for backwards compatibility
export type { GeminiTypes } from "./GoogleGenAITypes";
