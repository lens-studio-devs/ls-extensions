# {{MODULE_NAME}}

SpecsNDK CoreJs native module (scaffolded next to an existing Lens Studio project). {{DEFAULT_EXPORTS_BLURB}}


## SpecsNDK path

Default SDK root is `~/Dev/SpecsNDK` (`$HOME` / `$ENV{HOME}` in CMake). If missing, run the **specs-ndk** skill’s `references/setup.mdx` before building.

Override: `bash ./build.sh /other/SpecsNDK` or `-DSPECSNDK_ROOT=...`.

## Build

```bash
bash ./build.sh
bash ./build.sh {{SPECSNDK_ROOT_DEFAULT_SHELL}}
```

`OUTPUT_SO_DIR` in `build.sh` defaults to the Lens project’s **`Assets/NativeModules`** (parent of this folder + `Assets/NativeModules`). When set, a successful build copies `lib{{MODULE_NAME}}.so` there.

CMake directly:

```bash
cmake -S . -B build -DSPECSNDK_ROOT={{SPECSNDK_ROOT_DEFAULT_SHELL}} -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

## Lens Studio

Load `NativeModules/lib{{MODULE_NAME}}.so` from your project scripts; register exports to match this module’s `assignNativeFunctions`. The scaffold script can also add **`Assets/Scripts/<FeatureName>NativeModule.ts`** (types, **`@<FeatureName>NativeModule()`**, **`…NativeModule.load(self, onLoaded)`**) and **`Assets/Scripts/<FeatureName>Controller.ts`**. From **`onAwake`**, call **`void …NativeModule.load(this, yourCallback)`** — **`yourCallback.call(this, lib)`** runs after the field is assigned. The field decorator does not load the `.so` by itself. Derive **`FeatureName`** from the module name by dropping a trailing **`Module`** suffix when present. Keep both TS files in sync when you add exports.
