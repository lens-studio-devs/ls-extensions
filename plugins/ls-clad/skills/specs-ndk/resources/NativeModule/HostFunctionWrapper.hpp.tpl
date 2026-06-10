#pragma once

#if __has_include(<corejs_abi/abi.h>)
#include <corejs_abi/abi.h>
#elif __has_include(<snap/corejs_abi/abi.h>)
#include <snap/corejs_abi/abi.h>
#else
#error "Missing corejs_abi header"
#endif

#include <functional>
#include <utility>

namespace usercode {
using HostFunction = std::function<CoreJsAbiValueOrError(
    CoreJsAbiRuntime* rt, const CoreJsAbiValue* this_arg, const CoreJsAbiValue* args, size_t arg_count)>;

struct HostFunctionWrapper : public CoreJsAbiHostFunction {
private:
    static void release(struct CoreJsAbiHostFunction* self) {
        delete static_cast<HostFunctionWrapper*>(self);
    }

    static CoreJsAbiValueOrError call(struct CoreJsAbiHostFunction* self,
                                      struct CoreJsAbiRuntime* rt,
                                      const struct CoreJsAbiValue* this_arg,
                                      const struct CoreJsAbiValue* args,
                                      size_t arg_count) {
        auto* impl = static_cast<HostFunctionWrapper*>(self);
        return impl->hostFunction_(rt, this_arg, args, arg_count);
    }

    static constexpr CoreJsAbiHostFunctionVTable vtable_{.release = release, .call = call};
    HostFunction hostFunction_;

public:
    explicit HostFunctionWrapper(HostFunction hostFunction)
        : CoreJsAbiHostFunction(&vtable_), hostFunction_(std::move(hostFunction)) {}
};
} // namespace usercode
