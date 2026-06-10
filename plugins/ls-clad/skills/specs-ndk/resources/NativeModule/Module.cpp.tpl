#include "{{MODULE_NAME}}.hpp"
#include "HostFunctionWrapper.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <string_view>

namespace usercode {
namespace {

CoreJsAbiValueOrError ping_impl(CoreJsAbiRuntime*, const CoreJsAbiValue*, const CoreJsAbiValue*, size_t) {
    return {CoreJsAbiValue{.kind = CoreJsAbiValueKindNumber, .data = {.number = 1.0}}};
}

void release_managed_pointer(CoreJsAbiManagedPointer* p) {
    if (p != nullptr) {
        p->vtable->release(p);
    }
}

// SPECSNDK_RGBA_IMPL_BEGIN
// Fixed preview dimensions (RGBA8). Change here if you need a different size.
constexpr int kFrameWidth = 256;
constexpr int kFrameHeight = 256;

uint64_t s_frameAnimTick = 0;

void fill_animated_gradient_rgba(uint8_t* out, int w, int h, uint64_t tick) {
    const double phase = 0.02 * static_cast<double>(tick);
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const size_t i = (static_cast<size_t>(y) * static_cast<size_t>(w) + static_cast<size_t>(x)) * 4;
            const double u = (static_cast<double>(x) + 0.5) / static_cast<double>(w);
            const double v = (static_cast<double>(y) + 0.5) / static_cast<double>(h);
            out[i + 0] = static_cast<uint8_t>(255.0 * (0.5 + 0.5 * std::sin(u * 6.28318530718 + phase)));
            out[i + 1] = static_cast<uint8_t>(255.0 * (0.5 + 0.5 * std::sin(v * 6.28318530718 + phase * 1.3)));
            out[i + 2] = static_cast<uint8_t>(255.0 * (0.5 + 0.5 * std::sin((u + v) * 6.28318530718 + phase * 0.7)));
            out[i + 3] = 255;
        }
    }
}

void release_pixel_buffer(CoreJsAbiMutableBuffer* self) {
    delete[] static_cast<uint8_t*>(self->data);
    delete self;
}

static constexpr CoreJsAbiMutableBufferVTable kPixelBufferVtable{.release = release_pixel_buffer};

/// Returns one JS object: `{ buffer: ArrayBuffer, width: number, height: number }`.
CoreJsAbiValueOrError get_frame_rgba_impl(CoreJsAbiRuntime* rt, const CoreJsAbiValue*, const CoreJsAbiValue*, size_t) {
    ++s_frameAnimTick;

    const size_t nbytes = static_cast<size_t>(kFrameWidth) * static_cast<size_t>(kFrameHeight) * 4;
    auto* pixels = new (std::nothrow) uint8_t[nbytes];
    if (pixels == nullptr) {
        std::string_view errorMsg = "getFrameRGBA: pixel allocation failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    fill_animated_gradient_rgba(pixels, kFrameWidth, kFrameHeight, s_frameAnimTick);

    auto* mutableBuf = new (std::nothrow) CoreJsAbiMutableBuffer{&kPixelBufferVtable, pixels, nbytes};
    if (mutableBuf == nullptr) {
        delete[] pixels;
        std::string_view errorMsg = "getFrameRGBA: buffer handle allocation failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    CoreJsAbiArrayBufferOrError abOrErr = rt->vt->create_arraybuffer_from_external_data(rt, mutableBuf);
    if (abOrErr.is_error) {
        mutableBuf->vtable->release(mutableBuf);
        std::string_view errorMsg = "getFrameRGBA: create_arraybuffer_from_external_data failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    CoreJsAbiManagedPointer* abPtr = abOrErr.ptr_or_error.ptr;

    CoreJsAbiObjectOrError objOrErr = rt->vt->create_object(rt);
    if (objOrErr.is_error) {
        release_managed_pointer(abPtr);
        std::string_view errorMsg = "getFrameRGBA: create_object failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    CoreJsAbiManagedPointer* objPtr = objOrErr.ptr_or_error.ptr;
    CoreJsAbiObject frameObj{.pointer = objPtr};

    CoreJsAbiValue widthVal{
        .kind = CoreJsAbiValueKindNumber, .data = {.number = static_cast<double>(kFrameWidth)}};
    if (rt->vt->set_object_property_from_string(rt, &frameObj, "width", 5, &widthVal).is_error) {
        release_managed_pointer(objPtr);
        release_managed_pointer(abPtr);
        std::string_view errorMsg = "getFrameRGBA: set width failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    CoreJsAbiValue heightVal{
        .kind = CoreJsAbiValueKindNumber, .data = {.number = static_cast<double>(kFrameHeight)}};
    if (rt->vt->set_object_property_from_string(rt, &frameObj, "height", 6, &heightVal).is_error) {
        release_managed_pointer(objPtr);
        release_managed_pointer(abPtr);
        std::string_view errorMsg = "getFrameRGBA: set height failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    CoreJsAbiValue bufferVal{.kind = CoreJsAbiValueKindObject, .data = {.pointer = abPtr}};
    if (rt->vt->set_object_property_from_string(rt, &frameObj, "buffer", 6, &bufferVal).is_error) {
        release_managed_pointer(objPtr);
        release_managed_pointer(abPtr);
        std::string_view errorMsg = "getFrameRGBA: set buffer failed";
        rt->vt->set_string_error_value(rt, errorMsg.data(), errorMsg.size());
        return {CoreJsAbiValue{.kind = CoreJsAbiValueKindError}};
    }

    // set_object_property_from_string took ownership of abPtr; do not release here.
    CoreJsAbiValue out{.kind = CoreJsAbiValueKindObject, .data = {.pointer = objPtr}};
    return {out};
}
// SPECSNDK_RGBA_IMPL_END

bool register_export(CoreJsAbiRuntime* runtime,
                     CoreJsAbiObject* moduleObject,
                     std::string_view propName,
                     HostFunction fn) {
    auto wrappedFunction = std::make_unique<HostFunctionWrapper>(std::move(fn));
    CoreJsAbiFunctionOrError functionOrError =
        runtime->vt->create_function_from_host_function(runtime, wrappedFunction.get());
    if (functionOrError.is_error) {
        std::string_view errorMsg = "Failed creating native export function";
        runtime->vt->set_string_error_value(runtime, errorMsg.data(), errorMsg.size());
        return false;
    }
    wrappedFunction.release();

    CoreJsAbiManagedPointer* functionPtr = functionOrError.ptr_or_error.ptr;
    CoreJsAbiValue functionAsAbiValue{
        .kind = CoreJsAbiValueKindObject, .data = {.pointer = functionPtr}};
    if (runtime->vt
            ->set_object_property_from_string(
                runtime, moduleObject, propName.data(), propName.size(), &functionAsAbiValue)
            .is_error) {
        release_managed_pointer(functionPtr);
        std::string_view errorMsg = "Failed setting native export on module object";
        runtime->vt->set_string_error_value(runtime, errorMsg.data(), errorMsg.size());
        return false;
    }
    // set_object_property_from_string took ownership of functionPtr; do not release here.
    return true;
}

} // namespace

void assignNativeFunctions(CoreJsAbiRuntime* runtime, struct CoreJsAbiObject* moduleObject) {
    if (!register_export(runtime, moduleObject, "ping", ping_impl)) {
        return;
    }
// SPECSNDK_RGBA_REGISTER_BEGIN
    if (!register_export(runtime, moduleObject, "getFrameRGBA", get_frame_rgba_impl)) {
        return;
    }
// SPECSNDK_RGBA_REGISTER_END
}
} // namespace usercode

extern "C" {
void CoreJsOnLoad(CoreJsAbiRuntime* runtime, struct CoreJsAbiObject* moduleObject, void**) {
    usercode::assignNativeFunctions(runtime, moduleObject);
}

void CoreJsOnUnload(CoreJsAbiRuntime*, void*) {}
}
