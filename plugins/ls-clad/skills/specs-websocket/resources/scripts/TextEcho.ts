// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Simple WebSocket echo example demonstrating basic bidirectional communication.
 * Connects to a WebSocket server, sends text and binary messages, and logs all received messages.
 * Perfect for testing WebSocket connectivity with echo servers.
 */

import {bindStartEvent, bindDestroyEvent} from "SnapDecorators.lspkg/decorators"
import {assert} from "SnapDecorators.lspkg/assert"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"

@component
export class TextEcho extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">WebSocket Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Configure WebSocket connection settings</span>')

  @input
  @hint("Internet Module for WebSocket connectivity")
  internetModule: InternetModule;

  @input
  @hint("WebSocket server URL (e.g., ws://192.168.1.100/ws)")
  ipAddress: string = "ws://192.168.1.100/ws";

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (connection events, messages sent/received, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;
  private socket: WebSocket;

  /**
   * Called when component wakes up - initialize logger and validate inputs
   */
  onAwake(): void {
    const shouldLog = this.enableLogging || this.enableLoggingLifecycle;
    this.logger = new Logger("TextEcho", shouldLog, true);

    if (this.enableLoggingLifecycle) {
      this.logger.header("TextEcho Initialization");
      this.logger.debug("LIFECYCLE: onAwake() - Component waking up");
    }

    // Validate required inputs
    assert(this.internetModule !== null, "Internet Module must be assigned in the inspector");
    assert(this.internetModule !== undefined, "Internet Module must be assigned in the inspector");

    if (this.enableLoggingLifecycle) {
      this.logger.success("TextEcho initialized successfully");
    }
  }

  /**
   * Called on the first frame when the scene starts
   * Automatically bound to OnStartEvent via SnapDecorators
   */
  @bindStartEvent
  initialize(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: initialize() - Scene started");
    }

    this.connect();
  }

  /**
   * Called when the component is destroyed
   * Automatically bound to OnDestroyEvent via SnapDecorators
   */
  @bindDestroyEvent
  cleanup(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: cleanup() - Component destroyed");
    }

    if (this.socket) {
      try {
        this.socket.close();
        if (this.enableLogging) {
          this.logger.info("WebSocket connection closed");
        }
      } catch (e) {
        this.logger.error("Error closing WebSocket: " + e);
      }
    }

    if (this.enableLoggingLifecycle) {
      this.logger.success("Cleanup complete");
    }
  }

  /**
   * Establishes WebSocket connection to the echo server
   */
  private connect(): void {
    if (this.enableLogging) {
      this.logger.info("Attempting to connect to " + this.ipAddress);
    }

    try {
      this.socket = this.internetModule.createWebSocket(this.ipAddress);
      this.socket.binaryType = "blob";

      // Connection opened
      this.socket.onopen = (event: WebSocketEvent) => {
        if (this.enableLogging) {
          this.logger.success("WebSocket Connected!");
        }

        // Send a text message
        const msg = "Message 1";
        if (this.enableLogging) {
          this.logger.info("Sending text: " + msg);
        }
        this.socket.send(msg);

        // Send a binary message (the bytes spell 'Message 2')
        const message: number[] = [77, 101, 115, 115, 97, 103, 101, 32, 50];
        const bytes = new Uint8Array(message);
        if (this.enableLogging) {
          this.logger.info("Sending binary: Message 2");
        }
        this.socket.send(bytes);
      };

      // Message received
      this.socket.onmessage = async (event: WebSocketMessageEvent) => {
        if (event.data instanceof Blob) {
          // Binary frame
          const bytes = await event.data.bytes();
          const text = await event.data.text();
          if (this.enableLogging) {
            this.logger.success("Received binary (as text): " + text);
          }
        } else {
          // Text frame
          const text: string = event.data;
          if (this.enableLogging) {
            this.logger.success("Received text: " + text);
          }
        }
      };

      // Connection closed
      this.socket.onclose = (event: WebSocketCloseEvent) => {
        if (event.wasClean) {
          if (this.enableLogging) {
            this.logger.info("Socket closed cleanly");
          }
        } else {
          this.logger.warn("Socket closed with error, code: " + event.code);
        }
      };

      // Connection error
      this.socket.onerror = (event: WebSocketEvent) => {
        this.logger.error("Socket error occurred");
      };
    } catch (e) {
      this.logger.error("Error creating WebSocket: " + e);
    }
  }

  /**
   * Public API: Manually reconnect to the server
   */
  public reconnect(): void {
    if (this.enableLogging) {
      this.logger.info("Manual reconnection requested");
    }

    if (this.socket) {
      this.socket.close();
    }

    this.connect();
  }

  /**
   * Public API: Send a custom text message
   * @param message - Text message to send
   */
  public sendMessage(message: string): void {
    if (!this.socket || this.socket.readyState !== 1) {
      this.logger.error("Cannot send message - WebSocket not connected");
      return;
    }

    try {
      this.socket.send(message);
      if (this.enableLogging) {
        this.logger.info("Sent custom message: " + message);
      }
    } catch (e) {
      this.logger.error("Error sending message: " + e);
    }
  }

  /**
   * Public API: Get connection status
   * @returns Object containing connection status information
   */
  public getConnectionStatus(): { isConnected: boolean; url: string } {
    const isConnected = this.socket && this.socket.readyState === 1;
    return {
      isConnected: isConnected,
      url: this.ipAddress
    };
  }
}
