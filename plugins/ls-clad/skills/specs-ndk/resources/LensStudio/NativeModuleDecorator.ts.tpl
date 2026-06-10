/**
 * SpecsNDK native bridge for lib{{MODULE_NAME}}.so — types + field decorator + `load` for {{FEATURE_NAME}}Controller.
 * When you add native exports, extend {{FEATURE_NAME}}NativeExports (and call sites) alongside the C++ module.
 */

// SPECSNDK_RGBA_TYPES_BEGIN
export type {{FEATURE_NAME}}FrameRGBA = {
    buffer: ArrayBuffer;
    width: number;
    height: number;
};

// SPECSNDK_RGBA_TYPES_END
/** Shape of JS values exported from the CoreJs native module (see assignNativeFunctions in C++). */
export type {{FEATURE_NAME}}NativeExports = {
    ping: () => number;
// SPECSNDK_RGBA_EXPORT_BEGIN
    getFrameRGBA: () => {{FEATURE_NAME}}FrameRGBA;
// SPECSNDK_RGBA_EXPORT_END
};

/** Marks which field receives native exports (one decorated field per instance). */
const {{FEATURE_NAME}}NativeFieldKey = Symbol.for("specsndk.clad.{{MODULE_NAME}}.nativeField");

/**
 * Loads **`../NativeModules/lib{{MODULE_NAME}}.so`**, assigns exports to the **`@{{FEATURE_NAME}}NativeModule()`** field,
 * then calls **`onLoaded.call(self, exports)`**.
 */
async function load{{FEATURE_NAME}}NativeModule(
    self: BaseScriptComponent,
    onLoaded: (this: BaseScriptComponent, lib: {{FEATURE_NAME}}NativeExports) => void
): Promise<{{FEATURE_NAME}}NativeExports | null> {
    const inst = self as any;
    const propKey = inst[{{FEATURE_NAME}}NativeFieldKey] as string | symbol | undefined;
    if (propKey == null) {
        print(
            "{{FEATURE_NAME}}NativeModule.load: decorate a field with @" +
                "{{FEATURE_NAME}}NativeModule() before calling load()."
        );
        return null;
    }

    try {
        const asset = (await requireAsset("../NativeModules/lib{{MODULE_NAME}}.so")) as any;
        const exports = (await asset.load()) as {{FEATURE_NAME}}NativeExports;
        inst[propKey] = exports;
        onLoaded.call(self, exports);
        return exports;
    } catch (err) {
        print("{{FEATURE_NAME}}NativeModule: failed to load lib{{MODULE_NAME}}.so: " + err);
        inst[propKey] = null;
        return null;
    }
}

type {{FEATURE_NAME}}NativeModuleApi = (() => (_target: undefined, context: ClassFieldDecoratorContext) => void) & {
    load: typeof load{{FEATURE_NAME}}NativeModule;
};

/**
 * **`@{{FEATURE_NAME}}NativeModule()`** — field decorator only: initializes the field to **`null`**
 * and records where **`load`** assigns exports. It does **not** load the `.so`.
 *
 * **`{{FEATURE_NAME}}NativeModule.load(this, onLoaded)`** — loads the library, assigns the field, then
 * **`onLoaded.call(this, exports)`** (use **`this.onNativeLibraryLoaded`** or any **`(lib) => { … }`**).
 */
export const {{FEATURE_NAME}}NativeModule: {{FEATURE_NAME}}NativeModuleApi = Object.assign(
    function {{FEATURE_NAME}}NativeModule(): (
        _target: undefined,
        context: ClassFieldDecoratorContext
    ) => void {
        return function (_target: undefined, context: ClassFieldDecoratorContext) {
            const propertyKey = context.name;

            context.addInitializer(function (this: BaseScriptComponent) {
                const inst = this as any;
                inst[propertyKey] = null;
                if (inst[{{FEATURE_NAME}}NativeFieldKey] != null && inst[{{FEATURE_NAME}}NativeFieldKey] !== propertyKey) {
                    print(
                        "{{FEATURE_NAME}}NativeModule: only one @{{FEATURE_NAME}}NativeModule() field is supported per instance."
                    );
                }
                inst[{{FEATURE_NAME}}NativeFieldKey] = propertyKey;
            });
        };
    },
    { load: load{{FEATURE_NAME}}NativeModule }
) as {{FEATURE_NAME}}NativeModuleApi;
