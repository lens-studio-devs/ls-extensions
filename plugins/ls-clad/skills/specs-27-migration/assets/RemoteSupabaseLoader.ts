// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

@component
export class RemoteSupabaseLoader extends BaseScriptComponent {
    @input internetModule: InternetModule;
    @input remoteMediaModule: RemoteMediaModule;

    @input
    @hint("Public Supabase storage URL")
    url: string = "";

    @input
    @widget(new ComboBoxWidget()
        .addItem("ImageTexture", "image")
        .addItem("Bytes", "bytes")
        .addItem("GltfAsset", "gltf")
        .addItem("AudioTrack", "audio")
        .addItem("Font", "font")
        .addItem("String", "string")
        .addItem("RuntimeBundle", "bundle"))
    @hint("Which loadResourceAs* variant to use")
    kind: string = "image";

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.load());
    }

    private load() {
        const ok = (label: string) =>
            print("[RemoteSupabaseLoader] loaded " + label + " from " + this.url);
        const fail = (e: string) =>
            print("[RemoteSupabaseLoader] failed " + this.url + ": " + e);

        if (!this.internetModule) {
            fail("internetModule input is not assigned");
            return;
        }
        if (!this.remoteMediaModule) {
            fail("remoteMediaModule input is not assigned");
            return;
        }
        if (!this.url) {
            fail("url input is empty");
            return;
        }

        const resource = this.internetModule.makeResourceFromUrl(this.url);
        if (!resource) {
            fail("makeResourceFromUrl returned null");
            return;
        }

        switch (this.kind) {
            case "image":
                this.remoteMediaModule.loadResourceAsImageTexture(
                    resource,
                    (t) => ok("ImageTexture(" + t.getWidth() + "x" + t.getHeight() + ")"),
                    fail
                );
                break;
            case "bytes":
                this.remoteMediaModule.loadResourceAsBytes(
                    resource,
                    (b) => ok("Bytes(" + b.length + ")"),
                    fail
                );
                break;
            case "gltf":
                this.remoteMediaModule.loadResourceAsGltfAsset(resource, () => ok("GltfAsset"), fail);
                break;
            case "audio":
                this.remoteMediaModule.loadResourceAsAudioTrackAsset(resource, () => ok("AudioTrack"), fail);
                break;
            case "font":
                this.remoteMediaModule.loadResourceAsFont(resource, () => ok("Font"), fail);
                break;
            case "string":
                this.remoteMediaModule.loadResourceAsString(
                    resource,
                    (s) => ok("String(" + s.length + ")"),
                    fail
                );
                break;
            case "bundle":
                // Bundled-asset type matches what was uploaded:
                //   FileMesh     -> RenderMesh   (assign to RenderMeshVisual.mesh)
                //   ObjectPrefab -> ObjectPrefab (call .instantiate(parent))
                //   FileTexture  -> Texture      (use as material baseTex, etc.)
                // Default: just log. Replace this case with asset-specific behavior
                // mirroring whatever the original downloadAsset consumer did.
                this.remoteMediaModule.loadResourceAsRuntimeBundle(
                    resource,
                    () => ok("RuntimeBundle"),
                    fail
                );
                break;
            default:
                fail("unknown kind '" + this.kind + "'");
        }
    }
}
