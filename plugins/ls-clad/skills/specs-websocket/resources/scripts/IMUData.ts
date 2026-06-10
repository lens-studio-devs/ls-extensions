// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * IMU sensor data receiver via WebSocket for real-time motion tracking and 3D visualization.
 * Receives Inertial Measurement Unit (IMU) sensor data and applies rotation to a 3D object.
 * Data format: "angleX,angleZ,angleY" (CSV, angles in degrees).
 */

import {bindStartEvent, bindDestroyEvent} from "SnapDecorators.lspkg/decorators"
import {assert} from "SnapDecorators.lspkg/assert"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {IMUCube} from "./IMUCube"

@component
export class IMUData extends BaseScriptComponent {
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
  @ui.label('<span style="color: #60A5FA;">Component References</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Assign required components</span>')

  @input
  @hint("Text component for displaying connection status messages")
  screenText: Text;

  @input
  @hint("IMUCube script component that handles 3D rotation")
  cube: IMUCube;

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (connection events, data received, etc.)")
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
    this.logger = new Logger("IMUData", shouldLog, true);

    if (this.enableLoggingLifecycle) {
      this.logger.header("IMUData Initialization");
      this.logger.debug("LIFECYCLE: onAwake() - Component waking up");
    }

    // Validate required inputs
    assert(this.internetModule !== null, "Internet Module must be assigned in the inspector");
    assert(this.internetModule !== undefined, "Internet Module must be assigned in the inspector");
    assert(this.screenText !== null, "Screen Text component must be assigned in the inspector");
    assert(this.screenText !== undefined, "Screen Text component must be assigned in the inspector");
    assert(this.cube !== null, "IMUCube component must be assigned in the inspector");
    assert(this.cube !== undefined, "IMUCube component must be assigned in the inspector");

    if (this.enableLoggingLifecycle) {
      this.logger.success("IMUData initialized successfully");
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
   * Establishes WebSocket connection to the IMU sensor server
   */
  private connect(): void {
    this.screenText.text = "Connecting...";

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
        this.screenText.text = "Connected!";

        // Send initial handshake
        const msg = "HI FROM Spectacles";
        if (this.enableLogging) {
          this.logger.debug("Sending handshake: " + msg);
        }
        this.socket.send(msg);
      };

      // Message received
      this.socket.onmessage = async (event: WebSocketMessageEvent) => {
        let message: string;

        if (event.data instanceof Blob) {
          // Binary frame - convert to text
          message = await event.data.text();
        } else {
          // Text frame
          message = event.data;
        }

        // Parse CSV format: "angleX,angleZ,angleY"
        const angles = message.split(",").map((x) => {
          return parseFloat(x);
        });

        // Validate and apply rotation
        if (angles.length === 3 && !angles.some(isNaN)) {
          this.cube.setRotationAngle(angles);

          if (this.enableLogging) {
            this.logger.debug(`Angles received: [${angles[0].toFixed(2)}, ${angles[1].toFixed(2)}, ${angles[2].toFixed(2)}]`);
          }
        } else {
          this.logger.warn("Invalid data format: " + message);
        }
      };

      // Connection closed
      this.socket.onclose = (event: WebSocketCloseEvent) => {
        if (event.wasClean) {
          if (this.enableLogging) {
            this.logger.info("Socket closed cleanly");
          }
          this.screenText.text = "Disconnected";
        } else {
          this.logger.warn("Socket closed with error, code: " + event.code);
          this.screenText.text = "Connection error";
        }
      };

      // Connection error
      this.socket.onerror = (event: WebSocketEvent) => {
        this.logger.error("Socket error occurred");
        this.screenText.text = "Socket error";
      };
    } catch (e) {
      this.logger.error("Error creating WebSocket: " + e);
      this.screenText.text = "Connection failed";
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
