#pragma once

#if __has_include(<corejs_abi/abi.h>)
#include <corejs_abi/abi.h>
#elif __has_include(<snap/corejs_abi/abi.h>)
#include <snap/corejs_abi/abi.h>
#else
#error "Missing corejs_abi header"
#endif

extern "C" {
__attribute__((visibility("default")))
void CoreJsOnLoad(CoreJsAbiRuntime* runtime, struct CoreJsAbiObject* moduleObject, void** context);

__attribute__((visibility("default")))
void CoreJsOnUnload(CoreJsAbiRuntime* runtime, void* context);
}
