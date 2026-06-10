// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// Basic ASR example — minimal speech-to-text component.
// Extracted from the official ASR Module documentation.

@component
export class AsrExample extends BaseScriptComponent {
  private asrModule = require('LensStudio:AsrModule');

  private onTranscriptionUpdate(eventArgs: AsrModule.TranscriptionUpdateEvent) {
    print(
      `onTranscriptionUpdateCallback text=${eventArgs.text}, isFinal=${eventArgs.isFinal}`
    );
  }

  private onTranscriptionError(eventArgs: AsrModule.AsrStatusCode) {
    print(`onTranscriptionErrorCallback errorCode: ${eventArgs}`);
    switch (eventArgs) {
      case AsrModule.AsrStatusCode.InternalError:
        print('stopTranscribing: Internal Error');
        break;
      case AsrModule.AsrStatusCode.Unauthenticated:
        print('stopTranscribing: Unauthenticated');
        break;
      case AsrModule.AsrStatusCode.NoInternet:
        print('stopTranscribing: No Internet');
        break;
    }
  }

  onAwake(): void {
    const options = AsrModule.AsrTranscriptionOptions.create();
    options.silenceUntilTerminationMs = 1000;
    options.mode = AsrModule.AsrMode.HighAccuracy;
    options.onTranscriptionUpdateEvent.add((eventArgs) =>
      this.onTranscriptionUpdate(eventArgs)
    );
    options.onTranscriptionErrorEvent.add((eventArgs) =>
      this.onTranscriptionError(eventArgs)
    );

    this.asrModule.startTranscribing(options);
  }

  private stopSession(): void {
    this.asrModule.stopTranscribing();
  }
}
