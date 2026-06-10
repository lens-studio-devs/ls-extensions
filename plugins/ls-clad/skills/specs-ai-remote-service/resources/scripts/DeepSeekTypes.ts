// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * TypeScript type definitions for DeepSeek AI API. Defines request and response types for
 * chat completions including messages, tools, streaming chunks, and reasoning content for
 * the Snap-hosted DeepSeek R1 model integration.
 */
export namespace DeepSeekTypes {
    export namespace ChatCompletions {
        export type Role = "system" | "user" | "assistant" | "tool" | string;
        export type Model = "DeepSeek-R1" | string;
        export type ResponseFormat = "text" | "json_object" | string;

        export interface Message {
            role: Role;
            content: string;
            name?: string;
            tool_call_id?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
                id: string;
                type: string;
                function?: {
                    name: string;
                    arguments?: string;
                }
            }>;
            [key: string]: any;
        }

        export interface Tool {
                type: "function";
                function: {
                    name: string;
                    description?: string;
                    parameters?: Record<string, unknown>;
                };
                [key: string]: any;
            }

        /**
         * @link https://api-docs.deepseek.com/api/create-chat-completion#request
         */
        export interface Request {
            model: Model;
            messages: Array<Message>;
            temperature?: number;
            top_p?: number;
            max_tokens?: number;
            presence_penalty?: number;
            frequency_penalty?: number;
            stop?: Array<string>;
            seed?: number;
            response_format?: ResponseFormat
            tools?: Array<Tool>;
            tool_choice?: "none" | "auto" | "required" | {
                type: "function";
                function: {
                    name: string;
                };
            };
            logprobs?: boolean
            top_logprobs?: number;
            [key: string]: any;
        }

        export interface Choice {
            index: number;
            message: Message;
            logprobs?: {
                content: Array<{
                    token: string;
                    logprob: number;
                    bytes: Array<number>
                    top_logprobs?: Array<{
                        token: string;
                        logprob: number;
                        bytes: Array<number>;
                    }>;
                }>
            }
            finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "tool_calls" | "insufficient_system_resource" |string;
            [key: string]: any;
        }

        export interface Usage {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            prompt_cache_hit_tokens?: number;
            prompt_cache_miss_tokens?: number;
            [key: string]: any;
        }

        /**
         * @link https://api-docs.deepseek.com/api/create-chat-completion#responses
         */
        export interface Response {
            id: string;
            object: string;
            created: number;
            model: Model;
            choices: Array<Choice>;
            usage: Usage;
            [key: string]: any;
        }

        export interface ChunkChoice {
            index: number;
            delta: {
                role?: Role;
                content?: string;
                tool_calls?: Array<{
                    index: number;
                    id?: string;
                    type?: "function";
                    function?: {
                        name?: string;
                        arguments?: string;
                    };
                }>;
            };
            finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null | string;
            [key: string]: any;
        }

        export interface ChunkResponse {
            id: string;
            object: string;
            created: number;
            model: string;
            choices: Array<ChunkChoice>;
            [key: string]: any;
        }
    }
}
