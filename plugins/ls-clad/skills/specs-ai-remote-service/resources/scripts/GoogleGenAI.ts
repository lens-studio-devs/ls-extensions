// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Unified client for all Google GenAI APIs. Provides centralized access to Gemini (multimodal AI),
 * Lyria (music/vocal generation), and Imagen (image generation/editing) services with consistent
 * interfaces and backwards compatibility for existing implementations.
 */
import { Gemini } from "./Gemini";
import { Lyria } from "./Lyria";
import { Imagen } from "./Imagen";
import { GoogleGenAITypes } from "./GoogleGenAITypes";

export class GoogleGenAI {
  /**
   * Access to Gemini API for text and multimodal generation
   */
  static readonly Gemini = Gemini;

  /**
   * Access to Lyria API for music and vocal generation
   */
  static readonly Lyria = Lyria;

  /**
   * Access to Imagen API for image generation and editing
   */
  static readonly Imagen = Imagen;
}

// Re-export types for convenience
export type { GoogleGenAITypes } from "./GoogleGenAITypes";

// Backwards compatibility - re-export Gemini
export { Gemini };
