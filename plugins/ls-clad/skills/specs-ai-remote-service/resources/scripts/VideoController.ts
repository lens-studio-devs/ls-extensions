// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Camera video controller for streaming visual input to AI services. Captures camera frames
 * at configurable intervals, encodes them as Base64 JPG/PNG images, and emits encoded frames
 * for multimodal AI processing with vision capabilities.
 */
import Event from "../Utils/Event";

export class VideoController {
    private cameraModule: CameraModule = require("LensStudio:CameraModule") as CameraModule;
    private cameraTextureProvider: CameraTextureProvider;
    private cameraTexture: Texture;
    private sendRateMS: number = 2000;
    public onEncodedFrame = new Event<string>();
    private isRecording: boolean = false;
    private compressionQuality: CompressionQuality;
    private encodingType: EncodingType;
    private eventRegistration: EventRegistration;
    private lastRecordedTime: number = 0;

    /**
     *
     * @param sendRateMS - The rate at which video frames are sent in milliseconds. Default is 2000ms.
     * @param compressionQuality - The quality of the image compression. Default is CompressionQuality.IntermediateQuality.
     * @param encodingType - The type of encoding for the video frames. Default is EncodingType.Jpg.
     */
    constructor(
        sendRateMS: number = 2000,
        compressionQuality: CompressionQuality = CompressionQuality.IntermediateQuality,
        encodingType: EncodingType = EncodingType.Jpg
    ) {
        this.sendRateMS = sendRateMS;
        this.compressionQuality = compressionQuality;
        this.encodingType = encodingType;
    }

    /**
     * Starts the video recording and removes the event listener.
     */
    startRecording(){
        if(this.isRecording) {
            print("Already recording");
            return;
        }

        const cameraRequest = CameraModule.createCameraRequest();
        cameraRequest.cameraId = CameraModule.CameraId.Default_Color;
        this.cameraTexture = this.cameraModule.requestCamera(cameraRequest);
        this.cameraTextureProvider = this.cameraTexture.control as CameraTextureProvider;

        this.eventRegistration = this.cameraTextureProvider.onNewFrame.add((frame) => {
            if(this.lastRecordedTime + this.sendRateMS > getTime() * 1000) {
                return;
            }
            this.lastRecordedTime = getTime() * 1000;
            Base64.encodeTextureAsync(
                this.cameraTexture,
                (base64String) => {
                    if(base64String.length === 0){return;}
                    let prefix = "data:image/png;base64,"
                    if(this.encodingType == EncodingType.Jpg) {
                        prefix = "data:image/jpg;base64,"
                    }
                    const img = prefix + base64String;
                    this.onEncodedFrame.invoke(base64String);
                },
                () => {
                    print("Error encoding texture");
                },
                this.compressionQuality,
                this.encodingType
            )
        });

        this.isRecording = true;
    }

    /**
     * Stops the video recording and removes the event listener.
     */
    stopRecording(){
        if(!this.isRecording) {
            print("Not recording");
            return;
        }
        this.cameraTextureProvider.onNewFrame.remove(this.eventRegistration);
        this.isRecording = false;
    }
}
