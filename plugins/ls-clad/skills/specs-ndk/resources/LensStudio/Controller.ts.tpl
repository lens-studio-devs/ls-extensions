
import {
    {{FEATURE_NAME}}NativeModule,
    type {{FEATURE_NAME}}NativeExports,
} from "./{{FEATURE_NAME}}NativeModule";

@component
export class {{FEATURE_NAME}}Controller extends BaseScriptComponent {
    @{{FEATURE_NAME}}NativeModule()
    private nativeExports: {{FEATURE_NAME}}NativeExports | null = null;

// SPECSNDK_RGBA_FIELDS_BEGIN
    private procTexture: Texture | null = null;
    private procProvider: any = null;
    /** Root of **`FlippedImage.prefab`** (inside **`FlippedImage.lspkg`**) after **`instantiate(camera)`**; **`Image`** via **`getComponent`**. */
    private renderImage: Image | null = null;
// SPECSNDK_RGBA_FIELDS_END

    onAwake() {
// SPECSNDK_RGBA_ONAWAKE_BEGIN
        void this.setupFlippedImagePreviewThenContinue();
// SPECSNDK_RGBA_ONAWAKE_END
// SPECSNDK_PING_ONAWAKE_BEGIN
        {{FEATURE_NAME}}NativeModule.load(this, this.onNativeLibraryLoaded);
// SPECSNDK_PING_ONAWAKE_END
    }

    /** Runs as **`onNativeLibraryLoaded.call(this, lib)`** after **`load`** assigns the decorated field. */
    protected onNativeLibraryLoaded(lib: {{FEATURE_NAME}}NativeExports) {
        print("{{FEATURE_NAME}}Controller: native library loaded successfully");
        print("{{FEATURE_NAME}}Controller: ping -> " + lib.ping());
    }

// SPECSNDK_RGBA_ONUPDATE_BEGIN
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
// SPECSNDK_RGBA_ONUPDATE_END

// SPECSNDK_RGBA_TEX_BEGIN
    private async setupFlippedImagePreviewThenContinue(): Promise<void> {
        try {
            const flippedImage = (await requireAsset("../Prefabs/FlippedImage.lspkg/FlippedImage.prefab")) as ObjectPrefab;
            const cameraObject = this.findMainCameraSceneObject();
            if (cameraObject == null) {
                print("{{FEATURE_NAME}}Controller: no Camera / Main Camera / Camera Object under scene root");
            } else {
                const instanceRoot = flippedImage.instantiate(cameraObject);
                this.renderImage = instanceRoot.getComponent("Component.Image") as Image | null;
            }
        } catch (e) {
            print("{{FEATURE_NAME}}Controller: FlippedImage.prefab (FlippedImage.lspkg) failed: " + e);
        }
        {{FEATURE_NAME}}NativeModule.load(this, this.onNativeLibraryLoaded);
        this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    }

    private findMainCameraSceneObject(): SceneObject | null {
        const findByNameInSubtree = (parent: SceneObject, name: string): SceneObject | null => {
            if (parent.name === name) {
                return parent;
            }
            const n = parent.getChildrenCount();
            for (let i = 0; i < n; ++i) {
                const hit = findByNameInSubtree(parent.getChild(i), name);
                if (hit != null) {
                    return hit;
                }
            }
            return null;
        };
        const rootCount = global.scene.getRootObjectsCount();
        for (let i = 0; i < rootCount; ++i) {
            const root = global.scene.getRootObject(i);
            for (const nm of ["Camera", "Main Camera", "Camera Object"]) {
                const hit = findByNameInSubtree(root, nm);
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
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
// SPECSNDK_RGBA_TEX_END
}
