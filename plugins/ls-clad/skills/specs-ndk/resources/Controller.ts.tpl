
import {
    {{FEATURE_NAME}}NativeModule,
    type {{FEATURE_NAME}}NativeExports,
} from "./{{FEATURE_NAME}}NativeModule";

@component
export class {{FEATURE_NAME}}Controller extends BaseScriptComponent {
    @{{FEATURE_NAME}}NativeModule()
    private nativeExports: {{FEATURE_NAME}}NativeExports | null = null;

    private procTexture: Texture | null = null;
    private procProvider: any = null;

    @input
    @allowUndefined
    renderImage:Image


    onAwake() {
        {{FEATURE_NAME}}NativeModule.load(this, this.onNativeLibraryLoaded);
        this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    }

    /** Runs as **`onNativeLibraryLoaded.call(this, lib)`** after **`load`** assigns the decorated field. */
    protected onNativeLibraryLoaded(lib: {{FEATURE_NAME}}NativeExports) {
        print("{{FEATURE_NAME}}Controller: native library loaded successfully");
        print("{{FEATURE_NAME}}Controller: ping -> " + lib.ping());
    }

    private onUpdate() {
        const lib = this.nativeExports;
        if (!lib || !lib.getFrameRGBA) {
            return;
        }
        const frame = lib.getFrameRGBA();
        if (frame == null || frame.buffer == null) {
            return;
        }
        const w = frame.width;
        const h = frame.height;
        if (typeof w !== "number" || typeof h !== "number") {
            return;
        }
        this.updateImageTexture(frame.buffer, w, h);
    }

    //example to extract an image from the native module
    public updateImageTexture(buffer: ArrayBuffer, width: number, height: number) {
        if (!buffer || !this.renderImage) {
            return;
        }

        const rgba = new Uint8Array(buffer);
        if (rgba.length !== width * height * 4) {
            return;
        }

        if (this.procTexture == null || this.procTexture.getWidth() != width || this.procTexture.getHeight() != height) {
            this.procTexture = ProceduralTextureProvider.createWithFormat(width, height, TextureFormat.RGBA8Unorm);
            //set your image like this, please note: the image will likely be upside-down due to coordinate space and should flip the UV.y in the shader.
            this.renderImage.mainPass.baseTex = this.procTexture;
            this.procProvider = this.procTexture.control;
        }

        const provider = this.procProvider as ProceduralTextureProvider;
        provider.setPixels(0, 0, width, height, rgba);
    }
}
