// Copyright 2025 Google LLC.
// SPDX-License-Identifier: Apache-2.0

/**
 * Comprehensive TypeScript type definitions for Google GenAI APIs. Provides unified types for
 * Gemini (chat/live), Lyria (music/vocals), and Imagen (image generation) with support for
 * multimodal content, function calling, safety settings, and streaming responses.
 *
 * Unified types for Google GenAI APIs including Gemini, Lyria, and Imagen.
 * This namespace provides a centralized location for all Google GenAI API types
 * while maintaining backwards compatibility with existing Gemini implementations.
 */

export namespace GoogleGenAITypes {
  /**
   * Common types shared across all Google GenAI APIs
   */
  export namespace Common {
    /**
     *  @link https://ai.google.dev/api/generate-content#HarmBlockThreshold
     */
    export type HarmBlockThreshold =
      | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
      | "BLOCK_LOW_AND_ABOVE"
      | "BLOCK_MEDIUM_AND_ABOVE"
      | "BLOCK_ONLY_HIGH"
      | "BLOCK_NONE"
      | string;

    /**
     *  @link https://ai.google.dev/api/caching#Type
     */
    export type SchemaType =
      | "TYPE_UNSPECIFIED"
      | "STRING"
      | "NUMBER"
      | "INTEGER"
      | "BOOLEAN"
      | "ARRAY"
      | "OBJECT"
      | string;

    /**
     * @link https://ai.google.dev/api/caching#Mode_1
     */
    export type FunctionCallingMode =
      | "MODE_UNSPECIFIED"
      | "AUTO"
      | "ANY"
      | "NONE"
      | string;

    /**
     * @link https://ai.google.dev/api/caching#Part
     */
    export interface Part {
      text?: string;
      inlineData?: Blob;
      fileData?: FileData;
      functionCall?: FunctionCall;
      functionResponse?: FunctionResponse;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#Blob
     */
    export interface Blob {
      mimeType: string;
      data: string;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#FileData
     */
    export interface FileData {
      mimeType: string;
      fileUri: string;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#FunctionCall
     */
    export interface FunctionCall {
      name: string;
      id: string;
      args?: Record<string, any>;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#FunctionResponse
     */
    export interface FunctionResponse {
      name?: string;
      id?: string;
      response?: Record<string, any>;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#Content
     */
    export interface Content {
      parts: Part[];
      role?: "user" | "model" | "function" | "tool" | string;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#v1beta.SafetySetting
     */
    export interface SafetySetting {
      category: string;
      threshold: HarmBlockThreshold;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#v1beta.Candidate
     */
    export interface Candidate {
      content?: Content;
      finishReason?: string;
      index?: number;
      safetyRatings?: SafetyRating[];
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#v1beta.SafetyRating
     */
    export interface SafetyRating {
      category: string;
      probability?: string;
      blocked?: boolean;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#PromptFeedback
     */
    export interface PromptFeedback {
      blockReason?: string;
      safetyRatings?: SafetyRating[];
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#UsageMetadata
     */
    export interface UsageMetadata {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#Schema
     */
    export interface Schema {
      type: SchemaType;
      format?: string;
      description?: string;
      nullable?: boolean;
      enum?: string[];
      properties?: Record<string, Schema>;
      items?: Schema;
      required?: string[];
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#FunctionDeclaration
     */
    export interface FunctionDeclaration {
      name: string;
      description: string;
      parameters?: Schema;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#Tool
     */
    export interface Tool {
      functionDeclarations?: FunctionDeclaration[];
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#FunctionCallingConfig
     */
    export interface FunctionCallingConfig {
      mode?: FunctionCallingMode;
      allowedFunctionNames?: string[];
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/caching#ToolConfig
     */
    export interface ToolConfig {
      functionCallingConfig?: FunctionCallingConfig;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#SpeechConfig
     */
    export interface SpeechConfig {
      voiceConfig?: VoiceConfig;
      languageCode?: string;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#PrebuiltVoiceConfig
     */
    export interface PrebuiltVoiceConfig {
      voiceName?: string;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#VoiceConfig
     */
    export interface VoiceConfig {
      prebuiltVoiceConfig?: PrebuiltVoiceConfig;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#v1beta.GenerationConfig
     */
    export interface GenerationConfig {
      candidateCount?: number;
      stopSequences?: string[];
      maxOutputTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      responseMimeType?: "text/plain" | "application/json" | string;
      responseSchema?: Common.Schema;
      responseModalities?: string[];
      seed?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      responseLogprobs?: boolean;
      logprobs?: number;
      enableEnhancedCivicAnswers?: boolean;
      speechConfig?: Common.SpeechConfig;
      thinkingConfig?: ThinkingConfig;
      mediaResolution?: string;
      [key: string]: any;
    }

    /**
     * @link https://ai.google.dev/api/generate-content#ThinkingConfig
     */
    export interface ThinkingConfig {
      [key: string]: any;
    }
  }

  /**
   * Gemini API types and interfaces
   * @link https://ai.google.dev/gemini-api
   */
  export namespace Gemini {
    export namespace Models {
      /**
       * @link https://ai.google.dev/api/generate-content
       */
      export interface GenerateContentRequestBody {
        contents: Common.Content[];
        safetySettings?: Common.SafetySetting[];
        generationConfig?: Common.GenerationConfig;
        tools?: Common.Tool[];
        toolConfig?: Common.ToolConfig;
        systemInstruction?: Common.Content;
        cachedContent?: string;
        [key: string]: any;
      }

      /**
       * Request to generate content using the Gemini API.
       * required fields:
       * - model: The model to use for content generation.
       * - type: The type of request, typically "generateContent".
       * - body: The body of the request containing the content and generation parameters.
       */
      export type GenerateContentRequest = {
        model: string;
        type: string;
        body: GenerateContentRequestBody;
        [key: string]: any;
      };

      /**
       * @link https://ai.google.dev/api/generate-content#v1beta.GenerateContentResponse
       */
      export interface GenerateContentResponse {
        candidates?: Common.Candidate[];
        promptFeedback?: Common.PromptFeedback;
        usageMetadata?: Common.UsageMetadata;
        [key: string]: any;
      }
    }

    export namespace Live {
      export interface ClientMessageBase {
        [key: string]: any;
      }

      export interface ServerMessageBase {
        [key: string]: any;
      }

      /**
       * @link https://ai.google.dev/api/live#ContextWindowCompressionConfig.SlidingWindow
       */
      export interface SlidingWindow {
        targetTokens?: number;
      }

      /**
       * @link https://ai.google.dev/api/live#contextwindowcompressionconfig
       */
      export interface ContextWindowCompression {
        triggerTokens?: number;
        slidingWindow?: SlidingWindow;
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontentsetup
       */
      export interface Setup extends ClientMessageBase {
        setup: {
          model: string;
          generation_config?: Common.GenerationConfig;
          system_instruction?: Common.Content;
          tools?: Common.Tool[];
          contextWindowCompression?: ContextWindowCompression;
          input_audio_transcription?: Record<string, any>;
          output_audio_transcription?: Record<string, any>;
        };
      }

      // Realtime input interfaces
      export interface MediaChunk {
        mime_type: string;
        data: string;
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontentrealtimeinput
       */
      export interface RealtimeInput extends ClientMessageBase {
        realtime_input: {
          media_chunks?: MediaChunk[];
          text?: string;
          activity_start?: boolean;
          activity_end?: boolean;
          audio_stream_end?: boolean;
          audio?: Common.Blob;
          video?: Common.Blob;
        };
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontentclientcontent
       */
      export interface ClientContent extends ClientMessageBase {
        client_content: {
          turns?: Common.Content[];
          turn_complete?: boolean;
        };
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontenttoolresponse
       */
      export interface ToolResponse extends ClientMessageBase {
        tool_response: {
          function_responses: Common.FunctionResponse[];
        };
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontentsetupcomplete
       */
      export interface SetupCompleteEvent extends ServerMessageBase {
        setupComplete: Record<string, any>;
      }

      /**
       * @link https://ai.google.dev/api/live#BidiGenerateContentTranscription
       */
      export interface Transcription {
        text?: string;
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontentservercontent
       */
      export interface ServerContentEvent extends ServerMessageBase {
        serverContent: {
          modelTurn?: Common.Content;
          turnComplete?: boolean;
          interrupted?: boolean;
          groundingMetadata?: Record<string, any>;
          generationComplete?: boolean;
          inputTranscription?: Transcription;
          outputTranscription?: Transcription;
        };
      }

      export interface ContentServerMessageEvent extends ServerMessageBase {
        content: Common.Content;
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontenttoolcall
       */
      export interface ToolCallEvent extends ServerMessageBase {
        toolCall: {
          functionCalls?: Common.FunctionCall[];
        };
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontenttoolcallcancellation
       */
      export interface ToolCallCancellationEvent extends ServerMessageBase {
        toolCallCancellation: {
          ids: string[];
        };
      }

      /**
       * @link https://ai.google.dev/api/live#bidigeneratecontenttranscription
       */
      export interface TranscriptionEvent extends ServerMessageBase {
        transcription: {
          text?: string;
        };
      }

      export interface UsageMetadataEvent extends ServerMessageBase {
        usageMetadata: {
          promptTokenCount?: number;
          cachedContentTokenCount?: number;
          responseTokenCount?: number;
          toolUsePromptTokenCount?: number;
          thoughtsTokenCount?: number;
          totalTokenCount?: number;
        };
      }

      /**
       * @link https://ai.google.dev/api/live#goaway
       */
      export interface GoAwayEvent extends ServerMessageBase {
        goAway: {
          timeLeft?: string;
        };
      }

      export type ClientMessage =
        | Setup
        | RealtimeInput
        | ClientContent
        | ToolResponse;

      export type ServerMessage =
        | ServerContentEvent
        | ContentServerMessageEvent
        | SetupCompleteEvent
        | ToolCallEvent
        | ToolCallCancellationEvent
        | TranscriptionEvent
        | UsageMetadataEvent
        | GoAwayEvent;
    }
  }

  /**
   * Lyria API types for music generation
   * @link https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/lyria
   */
  export namespace Lyria {
    /**
     * Instance object for Lyria API request
     */
    export interface LyriaInstance {
      prompt: string;
      negative_prompt?: string;
      seed?: number;
      [key: string]: any;
    }

    /**
     * Parameters object for Lyria API request
     */
    export interface LyriaParameters {
      sample_count?: number;
      [key: string]: any;
    }

    /**
     * Complete Lyria API request body following the exact specification
     */
    export interface LyriaRequestBody {
      instances: LyriaInstance[];
      parameters?: LyriaParameters;
      [key: string]: any;
    }

    /**
     * Simplified request interface for easy usage
     */
    export interface GenerateMusicRequest {
      prompt: string;
      negative_prompt?: string;
      seed?: number;
      sample_count?: number;
      [key: string]: any;
    }

    /**
     * Audio prediction from Lyria API response
     * Each clip is 32.8 seconds long
     */
    export interface AudioPrediction {
      bytesBase64Encoded: string; // BASE64_ENCODED_WAV_STRING
      mimeType: "audio/wav" | string;
    }

    /**
     * Complete Lyria API response structure
     * A successful request returns a JSON object containing the generated audio data
     */
    export interface LyriaApiResponse {
      predictions: AudioPrediction[];
      deployedModelId: string;
      model: string;
      modelDisplayName: string;
    }

    /**
     * Generic Lyria API request structure
     */
    export interface LyriaRequest {
      model: string;
      type: string;
      body: LyriaRequestBody; // Flexible body to accommodate different API formats
      [key: string]: any;
    }

    /**
     * Generic Lyria API response structure
     * Updated to match the actual API response format
     */
    export interface LyriaResponse {
      predictions: AudioPrediction[];
      deployedModelId: string;
      model: string;
      modelDisplayName: string;
      error?: {
        code?: number;
        message?: string;
        details?: any;
      };
      [key: string]: any;
    }
  }

  /**
   * Imagen API types for image generation, editing, and upscaling
   * @link https://cloud.google.com/vertex-ai/generative-ai/docs/image/overview
   */
  export namespace Imagen {
    /**
     * Request for image generation
     */
    export interface GenerateImageRequest {
      instances: ImagenInstance[];
      parameters?: ImagenParameters;
      [key: string]: any;
    }

    export interface ImagenInstance {
      prompt: string;
      [key: string]: any;
    }

    export interface ImagenParameters {
      addWatermark?: boolean;
      aspectRatio?: string;
      enhancePrompt?: boolean;
      language?: string;
      negativePrompt?: string;
      outputOptions?: any;
      personGeneration?: "dont_allow" | "allow_adult" | "allow_all" | string;
      safetySetting?:
        | "block_low_and_above"
        | "block_medium_and_above"
        | "block_only_high"
        | string;
      sampleCount: number;
      sampleImageSize?: "1K" | "2K" | string;
      seed?: number;
      storageUri?: string;
      [key: string]: any;
    }

    /**
     * Generic Imagen API request structure
     */
    export interface ImagenRequest {
      model:
        | "imagen-3.0-generate-002"
        | "imagen-4.0-fast-generate-001"
        | "imagen-4.0-generate-001"
        | "imagen-4.0-ultra-generate-001"
        | string;
      body: GenerateImageRequest;
      [key: string]: any;
    }

    export interface ImagenPrediction {
      bytesBase64Encoded: string;
      mimeType: string;
      prompt?: string;
      [key: string]: any;
    }

    /**
     * Generic Imagen API response structure
     */
    export interface ImagenResponse {
      predictions: ImagenPrediction[];
      [key: string]: any;
    }
  }
}

// Backwards compatibility: Re-export GeminiTypes namespace
export namespace GeminiTypes {
  export namespace Common {
    export type HarmBlockThreshold = GoogleGenAITypes.Common.HarmBlockThreshold;
    export type SchemaType = GoogleGenAITypes.Common.SchemaType;
    export type FunctionCallingMode =
      GoogleGenAITypes.Common.FunctionCallingMode;
    export type Part = GoogleGenAITypes.Common.Part;
    export type Blob = GoogleGenAITypes.Common.Blob;
    export type FileData = GoogleGenAITypes.Common.FileData;
    export type FunctionCall = GoogleGenAITypes.Common.FunctionCall;
    export type FunctionResponse = GoogleGenAITypes.Common.FunctionResponse;
    export type Content = GoogleGenAITypes.Common.Content;
    export type SafetySetting = GoogleGenAITypes.Common.SafetySetting;
    export type Candidate = GoogleGenAITypes.Common.Candidate;
    export type SafetyRating = GoogleGenAITypes.Common.SafetyRating;
    export type PromptFeedback = GoogleGenAITypes.Common.PromptFeedback;
    export type UsageMetadata = GoogleGenAITypes.Common.UsageMetadata;
    export type Schema = GoogleGenAITypes.Common.Schema;
    export type FunctionDeclaration =
      GoogleGenAITypes.Common.FunctionDeclaration;
    export type Tool = GoogleGenAITypes.Common.Tool;
    export type FunctionCallingConfig =
      GoogleGenAITypes.Common.FunctionCallingConfig;
    export type ToolConfig = GoogleGenAITypes.Common.ToolConfig;
    export type SpeechConfig = GoogleGenAITypes.Common.SpeechConfig;
    export type PrebuiltVoiceConfig =
      GoogleGenAITypes.Common.PrebuiltVoiceConfig;
    export type VoiceConfig = GoogleGenAITypes.Common.VoiceConfig;
    export type GenerationConfig = GoogleGenAITypes.Common.GenerationConfig;
    export type ThinkingConfig = GoogleGenAITypes.Common.ThinkingConfig;
  }

  export namespace Models {
    export type GenerateContentRequestBody =
      GoogleGenAITypes.Gemini.Models.GenerateContentRequestBody;
    export type GenerateContentRequest =
      GoogleGenAITypes.Gemini.Models.GenerateContentRequest;
    export type GenerateContentResponse =
      GoogleGenAITypes.Gemini.Models.GenerateContentResponse;

    // Backwards compatibility alias
    export type GeminiGenerateContentRequestBody = GenerateContentRequestBody;
  }

  export namespace Live {
    export type ClientMessageBase =
      GoogleGenAITypes.Gemini.Live.ClientMessageBase;
    export type ServerMessageBase =
      GoogleGenAITypes.Gemini.Live.ServerMessageBase;
    export type SlidingWindow = GoogleGenAITypes.Gemini.Live.SlidingWindow;
    export type ContextWindowCompression =
      GoogleGenAITypes.Gemini.Live.ContextWindowCompression;
    export type Setup = GoogleGenAITypes.Gemini.Live.Setup;
    export type MediaChunk = GoogleGenAITypes.Gemini.Live.MediaChunk;
    export type RealtimeInput = GoogleGenAITypes.Gemini.Live.RealtimeInput;
    export type ClientContent = GoogleGenAITypes.Gemini.Live.ClientContent;
    export type ToolResponse = GoogleGenAITypes.Gemini.Live.ToolResponse;
    export type SetupCompleteEvent =
      GoogleGenAITypes.Gemini.Live.SetupCompleteEvent;
    export type Transcription = GoogleGenAITypes.Gemini.Live.Transcription;
    export type ServerContentEvent =
      GoogleGenAITypes.Gemini.Live.ServerContentEvent;
    export type ContentServerMessageEvent =
      GoogleGenAITypes.Gemini.Live.ContentServerMessageEvent;
    export type ToolCallEvent = GoogleGenAITypes.Gemini.Live.ToolCallEvent;
    export type ToolCallCancellationEvent =
      GoogleGenAITypes.Gemini.Live.ToolCallCancellationEvent;
    export type TranscriptionEvent =
      GoogleGenAITypes.Gemini.Live.TranscriptionEvent;
    export type UsageMetadataEvent =
      GoogleGenAITypes.Gemini.Live.UsageMetadataEvent;
    export type GoAwayEvent = GoogleGenAITypes.Gemini.Live.GoAwayEvent;
    export type ClientMessage = GoogleGenAITypes.Gemini.Live.ClientMessage;
    export type ServerMessage = GoogleGenAITypes.Gemini.Live.ServerMessage;
  }
}
