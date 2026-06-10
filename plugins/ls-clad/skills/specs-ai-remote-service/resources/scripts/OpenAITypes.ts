// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * TypeScript type definitions for OpenAI API. Defines types for chat completions, image
 * generation/editing, speech synthesis, and realtime WebSocket interactions adapted for
 * Lens Studio with support for multimodal content and function calling.
 *
 * Interpretation of https://platform.openai.com/docs/api-reference/introduction for use in Lens Studio
 * Abide by OpenAI Terms of Use while using this code - https://openai.com/policies/row-terms-of-use/
 */

export namespace OpenAITypes {
  export namespace Common {
    export interface Usage {
      prompt_tokens: number;
      completion_tokens?: number;
      total_tokens: number;
      [key: string]: any;
    }

    export interface FileObject {
      id?: string;
      object: "file";
      bytes: number;
      created_at: number;
      filename: string;
      purpose: string;
      status?: "uploaded" | "processed" | "error" | string;
      status_details?: string | null;
      expires_at?: number;
      [key: string]: any;
    }

    export interface ErrorObject {
      code: string | null;
      message: string;
      param: string | null;
      type?: string;
      [key: string]: any;
    }

    export interface Metadata {
      [key: string]: string | number | boolean | null | undefined;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-functions
     */
    export interface ToolDefinition {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-tools
     */
    export interface Tool {
      type: "function" | string;
      function: ToolDefinition;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-tool_choice
     */
    export type ToolChoiceOption =
      | "none"
      | "auto"
      | "required"
      | {
          type: "function";
          function: {
            name: string;
            [key: string]: any;
          };
          [key: string]: any;
        };
  }

  export namespace ChatCompletions {
    export type Role = "system" | "user" | "assistant" | "tool" | string;

    export interface ContentPartText {
      type: "text";
      text: string;
      [key: string]: any;
    }

    export interface ContentPartImage {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | string;
        [key: string]: any;
      };
      [key: string]: any;
    }

    export type ContentPart = ContentPartText | ContentPartImage;

    export interface MessageToolCallFunction {
      name: string;
      arguments: string;
      [key: string]: any;
    }

    export interface MessageToolCall {
      id?: string;
      type: "function" | string;
      function: MessageToolCallFunction;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-messages
     */
    export interface Message {
      role: Role;
      content: string | Array<ContentPart>;
      name?: string;
      tool_call_id?: string;
      tool_calls?: Array<MessageToolCall>;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-response_format
     */
    export interface ResponseFormat {
      type?: "text" | "json_object" | "json_schema" | string;
      json_schema?: {
        name: string;
        description?: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
      [key: string]: any;
    }

    export interface AudioParameters {
      voice?:
        | "alloy"
        | "echo"
        | "fable"
        | "onyx"
        | "nova"
        | "shimmer"
        | "sage"
        | "verse"
        | string;
      response_format?:
        | "mp3"
        | "opus"
        | "aac"
        | "flac"
        | "wav"
        | "pcm"
        | string;
      speed?: number;
      [key: string]: any;
    }

    export interface WebSearchOptions {
      max_browser_tool_results?: number;
      result_chunk_max_tokens?: number;
      safe_search?: "strict" | "moderate" | "off" | string;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/create
     */
    export interface Request {
      messages: Array<Message>;
      model: string;
      frequency_penalty?: number | null;
      logit_bias?: Record<string, number> | null;
      logprobs?: boolean | null;
      top_logprobs?: number | null;
      max_tokens?: number | null;
      max_completion_tokens?: number | null;
      n?: number | null;
      presence_penalty?: number | null;
      response_format?: ResponseFormat | null;
      seed?: number | null;
      stop?: string | Array<string> | null;
      stream?: boolean | null;
      stream_options?: { include_usage?: boolean; [key: string]: any } | null;
      temperature?: number | null;
      top_p?: number | null;
      tools?: Array<Common.Tool> | null;
      tool_choice?: Common.ToolChoiceOption | null;
      user?: string | null;
      metadata?: OpenAITypes.Common.Metadata | null;
      modalities?: Array<"text" | "audio" | string> | null;
      audio?: AudioParameters | null;
      parallel_tool_calls?: boolean;
      prediction?: Record<string, any> | null;
      reasoning_effort?: "low" | "medium" | "high" | string | null;
      service_tier?: "auto" | "default" | "flex" | string | null;
      store?: boolean | null;
      web_search_options?: WebSearchOptions | null;
      [key: string]: any;
    }

    export interface ResponseMessage {
      role: Role;
      content: string | null;
      tool_calls?: Array<MessageToolCall>;
      refusal?: string | null;
      annotations?: Array<any>;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/object#chat/object-choices
     */
    export interface Choice {
      index: number;
      message: ResponseMessage;
      logprobs: {
        content: Array<{
          token: string;
          logprob: number;
          bytes: Array<number> | null;
          top_logprobs: Array<{
            token: string;
            logprob: number;
            bytes: Array<number> | null;
          }>;
        }> | null;
        [key: string]: any;
      } | null;
      finish_reason:
        | "stop"
        | "length"
        | "tool_calls"
        | "content_filter"
        | "function_call"
        | string;
      [key: string]: any;
    }

    export interface UsageDetails {
      cached_tokens?: number;
      audio_tokens?: number;
      reasoning_tokens?: number;
      accepted_prediction_tokens?: number;
      rejected_prediction_tokens?: number;
      [key: string]: any;
    }

    /**
     * @link https://platform.openai.com/docs/api-reference/chat/object
     */
    export interface Response {
      id?: string;
      object: "chat.completion";
      created: number;
      model: string;
      choices: Array<Choice>;
      usage?: OpenAITypes.Common.Usage & {
        prompt_tokens_details?: UsageDetails;
        completion_tokens_details?: UsageDetails;
      };
      system_fingerprint?: string;
      service_tier?: string | null;
      request_id?: string;
      tool_choice?: Common.ToolChoiceOption | null;
      seed?: number | null;
      top_p?: number | null;
      temperature?: number | null;
      presence_penalty?: number | null;
      frequency_penalty?: number | null;
      input_user?: string | null;
      tools?: Array<Common.Tool> | null;
      metadata?: OpenAITypes.Common.Metadata | null;
      response_format?: ResponseFormat | null;
      [key: string]: any;
    }

    export interface ChunkDelta {
      content?: string | null;
      role?: Role;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function" | string;
        function?: {
          name?: string;
          arguments?: string;
        };
        [key: string]: any;
      }>;
      refusal?: string | null;
      annotations?: Array<any>;
      [key: string]: any;
    }

    export interface ChunkChoice {
      index: number;
      delta: ChunkDelta;
      logprobs?: {
        content: Array<{
          token: string;
          logprob: number;
          bytes: Array<number> | null;
          top_logprobs: Array<{
            token: string;
            logprob: number;
            bytes: Array<number> | null;
          }>;
        }> | null;
        [key: string]: any;
      } | null;
      finish_reason:
        | "stop"
        | "length"
        | "tool_calls"
        | "content_filter"
        | "function_call"
        | null
        | string;
      [key: string]: any;
    }

    export interface ChunkResponse {
      id?: string;
      object: "chat.completion.chunk";
      created: number;
      model: string;
      choices: Array<ChunkChoice>;
      system_fingerprint?: string;
      usage?: OpenAITypes.Common.Usage | null;
      service_tier?: string | null;
      [key: string]: any;
    }
  }

  export namespace ImageGenerate {
    export type Model = "dall-e-2" | "dall-e-3" | "gpt-image-1" | string;
    export type Quality =
      | "standard"
      | "hd"
      | "auto"
      | "high"
      | "medium"
      | "low"
      | string;
    export type Style = "vivid" | "natural" | string;
    export type ResponseFormat = "url" | "b64_json" | string;
    export type OutputFormatGptImage1 = "png" | "jpeg" | "webp" | string;
    export type BackgroundGptImage1 =
      | "transparent"
      | "opaque"
      | "auto"
      | string;
    export type ModerationGptImage1 = "low" | "auto" | string;

    /**
     * @link https://platform.openai.com/docs/api-reference/images/create
     */
    export interface Request {
      prompt: string;
      model?: Model | null;
      n?: number | null;
      quality?: Quality | null;
      response_format?: ResponseFormat | null;
      size?: string | null;
      style?: Style | null;
      user?: string | null;
      background?: BackgroundGptImage1 | null;
      moderation?: ModerationGptImage1 | null;
      output_compression?: number | null;
      output_format?: OutputFormatGptImage1 | null;
      [key: string]: any;
    }

    export interface ImageObject {
      b64_json?: string;
      url?: string;
      revised_prompt?: string;
      [key: string]: any;
    }

    export interface UsageDetails {
      text_tokens?: number;
      image_tokens?: number;
      [key: string]: any;
    }

    export interface ImageUsage extends OpenAITypes.Common.Usage {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: UsageDetails;
    }

    export interface Response {
      created: number;
      data: Array<ImageObject>;
      usage?: ImageUsage;
      [key: string]: any;
    }
  }

  export namespace ImageEdits {
    export interface Request {
      image: Uint8Array | Uint8Array[]; // I think these are base64 decoded images?
      prompt: string | null;
      background?: string | null;
      mask?: Uint8Array; // FIGURE THIS ONE OUT
      model?: string;
      n: number | null;
      output_compression?: number | null;
      output_format?: "png" | "jpeg" | "webp" | string | null;
      response_format?: "url" | "b64_json" | string | null;
      size?:
        | "1536x1024"
        | "1024x1536"
        | "1024x1024"
        | "256x256"
        | "512x512"
        | "auto"
        | string
        | null;
    }
  }

  /**
   * @link https://platform.openai.com/docs/api-reference/audio/createSpeech
   */
  export namespace Speech {
    export type Model = "tts-1" | "tts-1-hd" | "gpt-4o-mini-tts" | string;
    export type Voice =
      | "alloy"
      | "echo"
      | "fable"
      | "onyx"
      | "nova"
      | "shimmer"
      | "sage"
      | "verse"
      | string;
    export type ResponseFormat =
      | "mp3"
      | "opus"
      | "aac"
      | "flac"
      | "wav"
      | "pcm"
      | string;

    export interface Request {
      model: Model;
      input: string;
      voice: Voice;
      response_format?: ResponseFormat | null;
      speed?: number | null;
      instructions?: string | null;
      [key: string]: any;
    }
  }

  export namespace Realtime {
    export type AudioFormat = "pcm16" | "g711_ulaw" | "g711_alaw" | string;
    export type Model = "gpt-4o-realtime-preview" | string;
    export type Voice =
      | "alloy"
      | "ash"
      | "ballad"
      | "coral"
      | "echo"
      | "fable"
      | "onyx"
      | "nova"
      | "sage"
      | "shimmer"
      | "verse"
      | string;

    export interface InputAudioNoiseReduction {
      type: "near_field" | "far_field" | string;
      strength?: number;
      [key: string]: any;
    }

    export interface InputAudioTranscription {
      model?: "whisper-1" | "gpt-4o-transcribe" | string;
      language?: string | null;
      prompt?: string | null;
      [key: string]: any;
    }

    export interface TurnDetectionServerVAD {
      type: "server_vad";
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
      create_response?: boolean;
      interrupt_response?: boolean;
      [key: string]: any;
    }

    export interface TurnDetectionSemanticVAD {
      type: "semantic_vad";
      threshold?: number;
      prefix_padding_ms?: number;
      dynamic_timeout_enabled?: boolean;
      dynamic_timeout_ms?: number;
      min_timeout_ms?: number;
      max_timeout_ms?: number;
      create_response?: boolean;
      interrupt_response?: boolean;
      [key: string]: any;
    }

    export type TurnDetection =
      | TurnDetectionServerVAD
      | TurnDetectionSemanticVAD
      | null;

    /**
     * @link https://platform.openai.com/docs/api-reference/realtime-sessions/create
     */
    export interface SessionParameters {
      input_audio_format?: AudioFormat;
      input_audio_noise_reduction?: InputAudioNoiseReduction | null;
      input_audio_transcription?: InputAudioTranscription | null;
      instructions?: string;
      max_response_output_tokens?: number | "inf";
      modalities?: Array<"text" | "audio" | string>;
      model?: Model;
      output_audio_format?: AudioFormat;
      temperature?: number;
      tool_choice?: Common.ToolChoiceOption;
      tools?: Array<Common.ToolDefinition>;
      turn_detection?: TurnDetection;
      voice?: Voice;
      [key: string]: any;
    }

    // --- Client Messages ---
    export interface ClientEventBase {
      event_id?: string;
      type: string;
      [key: string]: any;
    }

    // Client Session Messages
    export interface SessionUpdateRequest extends ClientEventBase {
      //
      type: "session.update";
      session: SessionParameters;
    }
    export type ClientSessionMessages = SessionUpdateRequest;

    // Client InputAudioBuffer Messages
    export interface InputAudioBufferAppendRequest extends ClientEventBase {
      //
      type: "input_audio_buffer.append";
      audio: string; // Base64 encoded
    }
    export interface InputAudioBufferCommitRequest extends ClientEventBase {
      //
      type: "input_audio_buffer.commit";
    }
    export interface InputAudioBufferClearRequest extends ClientEventBase {
      //
      type: "input_audio_buffer.clear";
    }
    export type ClientInputAudioBufferMessages =
      | InputAudioBufferAppendRequest
      | InputAudioBufferCommitRequest
      | InputAudioBufferClearRequest;

    // Client Conversation Messages
    export interface ConversationItemContentPart {
      type:
        | "input_text"
        | "output_text"
        | "input_audio"
        | "output_audio"
        | "function_call_response"
        | string;
      text?: string;
      audio?: string; // Base64
      transcript?: string;
      name?: string;
      arguments?: string;
      [key: string]: any;
    }
    export interface ConversationItem {
      id?: string;
      type: "message" | "function_call" | "function_call_response" | string;
      role?: "user" | "assistant" | "tool" | string;
      content?: Array<ConversationItemContentPart>;
      status?: "in_progress" | "completed" | "failed" | "cancelled" | string;
      [key: string]: any;
    }
    export interface ConversationItemCreateRequest extends ClientEventBase {
      //
      type: "conversation.item.create";
      previous_item_id?: string | "root" | null;
      item: ConversationItem;
    }
    export interface ConversationItemRetrieveRequest extends ClientEventBase {
      //
      type: "conversation.item.retrieve";
      item_id?: string;
    }
    export interface ConversationItemTruncateRequest extends ClientEventBase {
      //
      type: "conversation.item.truncate";
      item_id?: string;
      content_index: number;
      audio_end_ms: number;
    }
    export interface ConversationItemDeleteRequest extends ClientEventBase {
      //
      type: "conversation.item.delete";
      item_id?: string;
    }
    export type ClientConversationMessages =
      | ConversationItemCreateRequest
      | ConversationItemRetrieveRequest
      | ConversationItemTruncateRequest
      | ConversationItemDeleteRequest;

    // Client Response Messages
    export interface ResponseCreateParameters {
      modalities?: Array<"text" | "audio" | string>;
      instructions?: string;
      voice?: Voice;
      output_audio_format?: AudioFormat;
      tools?: Array<Common.Tool>;
      tool_choice?: Common.ToolChoiceOption;
      temperature?: number;
      max_output_tokens?: number | "inf";
      [key: string]: any;
    }
    export interface ResponseCreateRequest extends ClientEventBase {
      //
      type: "response.create";
      response: ResponseCreateParameters;
    }
    export interface ResponseCancelRequest extends ClientEventBase {
      //
      type: "response.cancel";
      response_id?: string;
    }
    export type ClientResponseMessages =
      | ResponseCreateRequest
      | ResponseCancelRequest;

    // Client TranscriptionSession Messages
    export interface TranscriptionSessionUpdateParameters {
      input_audio_format?: AudioFormat;
      input_audio_transcription?: InputAudioTranscription;
      turn_detection?: TurnDetection;
      input_audio_noise_reduction?: InputAudioNoiseReduction | null;
      include?: Array<string>;
      [key: string]: any;
    }
    export interface TranscriptionSessionUpdateRequest extends ClientEventBase {
      //
      type: "transcription_session.update";
      session: TranscriptionSessionUpdateParameters;
    }
    export type ClientTranscriptionSessionMessages =
      TranscriptionSessionUpdateRequest;

    // Client OutputAudioBuffer Messages (WebRTC Only)
    export interface OutputAudioBufferClearRequest extends ClientEventBase {
      //
      type: "output_audio_buffer.clear";
    }
    export type ClientOutputAudioBufferMessages = OutputAudioBufferClearRequest;

    // Top-level ClientMessage Union
    export type ClientMessage =
      | ClientSessionMessages
      | ClientInputAudioBufferMessages
      | ClientConversationMessages
      | ClientResponseMessages
      | ClientTranscriptionSessionMessages
      | ClientOutputAudioBufferMessages;

    // --- Server Messages ---
    export interface ServerEventBase {
      event_id?: string;
      type: string;
      sequence_number?: number;
      [key: string]: any;
    }

    export interface ServerErrorDetails {
      type: string;
      code: string;
      message: string;
      param: string | null;
      event_id?: string;
      [key: string]: any;
    }

    // Server Error Message
    export interface ErrorEvent extends ServerEventBase {
      //
      type: "error";
      error: ServerErrorDetails;
    }

    // Server Session Messages
    export interface ClientSecret {
      value: string;
      expires_at: number;
      [key: string]: any;
    }
    export interface SessionResponse extends SessionParameters {
      id?: string;
      object: "realtime.session" | string;
      client_secret: ClientSecret; // This is part of the REST response, not typically the WebSocket event session object
    }
    export interface SessionCreatedEvent extends ServerEventBase {
      //
      type: "session.created";
      session: SessionParameters & { id?: string; object: string }; // The session object in the event
    }
    export interface SessionUpdatedEvent extends ServerEventBase {
      //
      type: "session.updated";
      session: SessionParameters & { id?: string; object: string }; // The session object in the event
    }
    export type ServerSessionMessages =
      | SessionCreatedEvent
      | SessionUpdatedEvent;

    // Server Conversation Messages
    export interface Conversation {
      id?: string;
      object: "realtime.conversation" | string;
      [key: string]: any;
    }
    export interface ConversationCreatedEvent extends ServerEventBase {
      //
      type: "conversation.created";
      conversation: Conversation;
    }
    export interface ConversationItemCreatedEvent extends ServerEventBase {
      //
      type: "conversation.item.created";
      previous_item_id?: string | "root" | null;
      item: ConversationItem;
    }
    export interface ConversationItemRetrievedEvent extends ServerEventBase {
      //
      type: "conversation.item.retrieved"; // Corrected from PDF's example
      item: ConversationItem;
    }
    export interface Logprobs {
      tokens: Array<string>;
      token_logprobs: Array<number>;
      text_offset?: Array<number>;
      [key: string]: any;
    }
    export interface ConversationItemInputAudioTranscriptionCompletedEvent
      extends ServerEventBase {
      //
      type: "conversation.item.input_audio_transcription.completed";
      item_id?: string;
      content_index: number;
      transcript: string;
      logprobs?: Array<Logprobs> | null;
    }
    export interface ConversationItemInputAudioTranscriptionDeltaEvent
      extends ServerEventBase {
      //
      type: "conversation.item.input_audio_transcription.delta";
      item_id?: string;
      content_index: number;
      delta: string;
      logprobs?: Array<Logprobs> | null;
    }
    export interface TranscriptionError {
      type: "transcription_error" | string;
      code: string;
      message: string;
      param: string | null;
      [key: string]: any;
    }
    export interface ConversationItemInputAudioTranscriptionFailedEvent
      extends ServerEventBase {
      //
      type: "conversation.item.input_audio_transcription.failed";
      item_id?: string;
      content_index: number;
      error: TranscriptionError;
    }
    export interface ConversationItemTruncatedEvent extends ServerEventBase {
      //
      type: "conversation.item.truncated";
      item_id?: string;
      content_index: number;
      audio_end_ms: number;
    }
    export interface ConversationItemDeletedEvent extends ServerEventBase {
      //
      type: "conversation.item.deleted";
      item_id?: string;
    }
    export type ServerConversationMessages =
      | ConversationCreatedEvent
      | ConversationItemCreatedEvent
      | ConversationItemRetrievedEvent
      | ConversationItemInputAudioTranscriptionCompletedEvent
      | ConversationItemInputAudioTranscriptionDeltaEvent
      | ConversationItemInputAudioTranscriptionFailedEvent
      | ConversationItemTruncatedEvent
      | ConversationItemDeletedEvent;

    // Server InputAudioBuffer Messages
    export interface InputAudioBufferCommittedEvent extends ServerEventBase {
      //
      type: "input_audio_buffer.committed";
      previous_item_id?: string | "root" | null;
      item_id?: string;
    }
    export interface InputAudioBufferClearedEvent extends ServerEventBase {
      //
      type: "input_audio_buffer.cleared";
    }
    export interface InputAudioBufferSpeechStartedEvent
      extends ServerEventBase {
      //
      type: "input_audio_buffer.speech_started";
      audio_start_ms: number;
      item_id?: string;
    }
    export interface InputAudioBufferSpeechStoppedEvent
      extends ServerEventBase {
      //
      type: "input_audio_buffer.speech_stopped";
      audio_end_ms: number;
      item_id?: string;
    }
    export type ServerInputAudioBufferMessages =
      | InputAudioBufferCommittedEvent
      | InputAudioBufferClearedEvent
      | InputAudioBufferSpeechStartedEvent
      | InputAudioBufferSpeechStoppedEvent;

    // Server Response Messages (Realtime API specific, not Responses API Streaming)
    export interface RealtimeApiResponseObject {
      // Represents the `response` field in Realtime API's response events
      id?: string;
      object: "realtime.response" | string;
      status: "in_progress" | "completed" | "failed" | "cancelled" | string;
      status_details: any | null;
      output: Array<ConversationItem>;
      usage: OpenAITypes.Common.Usage | null;
      [key: string]: any;
    }
    export interface ResponseCreatedEvent extends ServerEventBase {
      //
      type: "response.created";
      response: RealtimeApiResponseObject;
    }
    export interface ResponseDoneEvent extends ServerEventBase {
      //
      type: "response.done";
      response: RealtimeApiResponseObject;
    }
    export interface ResponseOutputItemAddedEvent extends ServerEventBase {
      //
      type: "response.output_item.added";
      response_id?: string;
      output_index: number;
      item: ConversationItem;
    }
    export interface ResponseOutputItemDoneEvent extends ServerEventBase {
      //
      type: "response.output_item.done";
      response_id?: string;
      output_index: number;
      item: ConversationItem;
    }
    export interface ResponseContentPartAddedEvent extends ServerEventBase {
      //
      type: "response.content_part.added";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      part: ConversationItemContentPart;
    }
    export interface ResponseContentPartDoneEvent extends ServerEventBase {
      //
      type: "response.content_part.done";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      part: ConversationItemContentPart;
    }
    export interface ResponseTextDeltaEvent extends ServerEventBase {
      //
      type: "response.text.delta";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      delta: string;
    }
    export interface ResponseTextDoneEvent extends ServerEventBase {
      //
      type: "response.text.done";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      text: string;
    }
    export interface ResponseAudioTranscriptDeltaEvent extends ServerEventBase {
      //
      type: "response.audio_transcript.delta";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      delta: string;
    }
    export interface ResponseAudioTranscriptDoneEvent extends ServerEventBase {
      //
      type: "response.audio_transcript.done";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      transcript: string;
    }
    export interface ResponseAudioDeltaEvent extends ServerEventBase {
      //
      type: "response.audio.delta";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
      delta: string; // Base64 encoded audio data delta
    }
    export interface ResponseAudioDoneEvent extends ServerEventBase {
      //
      type: "response.audio.done";
      response_id?: string;
      item_id?: string;
      output_index: number;
      content_index: number;
    }
    export interface ResponseFunctionCallArgumentsDeltaEvent
      extends ServerEventBase {
      //
      type: "response.function_call_arguments.delta";
      response_id?: string;
      item_id?: string;
      output_index: number;
      call_id?: string;
      delta: string; // JSON string part
    }
    export interface ResponseFunctionCallArgumentsDoneEvent
      extends ServerEventBase {
      //
      type: "response.function_call_arguments.done";
      response_id?: string;
      item_id?: string;
      output_index: number;
      call_id?: string;
      arguments: string; // Full JSON string
    }
    export type ServerResponseMessages =
      | ResponseCreatedEvent
      | ResponseDoneEvent
      | ResponseOutputItemAddedEvent
      | ResponseOutputItemDoneEvent
      | ResponseContentPartAddedEvent
      | ResponseContentPartDoneEvent
      | ResponseTextDeltaEvent
      | ResponseTextDoneEvent
      | ResponseAudioTranscriptDeltaEvent
      | ResponseAudioTranscriptDoneEvent
      | ResponseAudioDeltaEvent
      | ResponseAudioDoneEvent
      | ResponseFunctionCallArgumentsDeltaEvent
      | ResponseFunctionCallArgumentsDoneEvent;

    // Server TranscriptionSession Messages
    export interface TranscriptionSessionResponse {
      // As defined for REST, structure likely similar in event
      id?: string;
      object: "realtime.transcription_session" | string;
      modalities?: Array<"text" | "audio" | string>;
      turn_detection?: TurnDetection;
      input_audio_format?: AudioFormat;
      input_audio_transcription?: InputAudioTranscription;
      client_secret: ClientSecret | null; // This might be specific to REST response
      expires_at?: number;
      [key: string]: any;
    }
    export interface TranscriptionSessionUpdatedEvent extends ServerEventBase {
      //
      type: "transcription_session.updated";
      session: TranscriptionSessionResponse & { id?: string; object: string };
    }
    export type ServerTranscriptionSessionMessages =
      TranscriptionSessionUpdatedEvent;

    // Server RateLimits Messages
    export interface RateLimitsUpdatedEvent extends ServerEventBase {
      //
      type: "rate_limits.updated";
      rate_limits: Array<{
        name: string;
        limit: number;
        remaining: number;
        reset_seconds: number;
        [key: string]: any;
      }>;
    }
    export type ServerRateLimitsMessages = RateLimitsUpdatedEvent;

    /**
     * A generic event type to catch any future or undocumented Realtime API server events.
     */
    export interface UnknownServerEvent extends ServerEventBase {
      type: string;
    }

    // Top-level ServerMessage Union
    export type ServerMessage =
      | ErrorEvent
      | ServerSessionMessages
      | ServerConversationMessages
      | ServerInputAudioBufferMessages
      | ServerResponseMessages
      | ServerTranscriptionSessionMessages
      | ServerRateLimitsMessages
      | UnknownServerEvent;

    export type RequestSession = {
      model: string;
      [key: string]: any;
    };
  }
}
