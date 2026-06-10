// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Audio buffer processor for streaming audio to external AI services. Converts Float32
 * audio frames to PCM16 format, manages buffering, and emits Base64-encoded chunks at
 * configurable intervals for real-time audio transmission.
 */
import Event from "../Utils/Event";

export class AudioProcessor {
    private sendRate: number = 100;
    private audioFrameBuffer: Uint8Array[] = [];
    private lastSendTime: number = -1;
    public onAudioChunkReady = new Event<string>();

    /**
     * Constructor for AudioProcessor.
     * @param sendRateMS - The rate at which audio frames are sent in milliseconds. Default is 100ms.
     */
    constructor(sendRateMS: number = 100){
        this.sendRate = sendRateMS/1000;
    }

    /**
     *
     * @param audioFrame - Float32 array representing the audio frame
     * This method converts the audio frame into PCM16 and appends it to the buffer.
     * If the buffer has enough data to send, it concatenates the audio frames into a single Uint8Array,
     * encodes it to Base64, and invokes the onAudioChunkReady event with the Base64 string.
     */
    processFrame(audioFrame: Float32Array){
        if(audioFrame.length == 0){
            return;
        }
        this.audioFrameBuffer.push(this.convertAudioFrameToPCM16(audioFrame));
        const currentTime = getTime();
        if(this.lastSendTime == -1){
            this.lastSendTime = currentTime;
            return;
        }
        else if(currentTime - this.lastSendTime < this.sendRate){
            return;
        }
        else{
            this.lastSendTime = currentTime;
        }
        const combinedAudioFrames = this.concatenateUint8Arrays([...this.audioFrameBuffer]);
        this.audioFrameBuffer = [];
        const b64AudioFrames = Base64.encode(combinedAudioFrames);
        this.onAudioChunkReady.invoke(b64AudioFrames);
    }

    /**
     * Converts a Float32Array audio frame to a Uint8Array in PCM16 format.
     * @param audioFrame - The Float32Array audio frame to convert.
     * @returns A Uint8Array representing the PCM16 audio data.
     */
    private convertAudioFrameToPCM16(audioFrame: Float32Array): Uint8Array{
        const int16Array = new Int16Array(audioFrame.length);
        for (let i = 0; i < audioFrame.length; i++) {
            const s = Math.max(-1, Math.min(1, audioFrame[i]));
            int16Array[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
        }
        return new Uint8Array(int16Array.buffer);
    }

    /**
     * Concatenates multiple Uint8Arrays into a single Uint8Array.
     * @param arrays - An array of Uint8Arrays to concatenate.
     * @returns A single Uint8Array containing all the data from the input arrays.
     */
    private concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
        if (arrays.length === 0) {
            return new Uint8Array(0);
        }

        let totalLength = 0;
        for (const arr of arrays) {
            totalLength += arr.byteLength;
        }

        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.byteLength;
        }
        return result;
    }
}
