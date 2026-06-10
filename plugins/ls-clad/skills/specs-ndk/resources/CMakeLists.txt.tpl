cmake_minimum_required(VERSION 3.25)
include_guard(GLOBAL)

set(SPECSNDK_ROOT "{{SPECSNDK_ROOT_DEFAULT_CMAKE}}" CACHE PATH "Path to SpecsNDK root (absolute; scaffold default is $ENV{HOME}/Dev/SpecsNDK)")

if(NOT IS_ABSOLUTE "${SPECSNDK_ROOT}")
  get_filename_component(SPECSNDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/${SPECSNDK_ROOT}" ABSOLUTE)
endif()

set(SPECSNDK_TOOLCHAIN_FILE "${SPECSNDK_ROOT}/SpecsNDK-Toolchain-Clang.cmake")
set(SPECSNDK_SNAP_INCLUDE "${SPECSNDK_ROOT}/sysroots/armv8a-snap-linux/usr/include/snap")

if(NOT EXISTS "${SPECSNDK_TOOLCHAIN_FILE}")
  message(FATAL_ERROR "Could not find toolchain file at: ${SPECSNDK_TOOLCHAIN_FILE}")
endif()

if(NOT EXISTS "${SPECSNDK_SNAP_INCLUDE}/corejs_abi/abi.h")
  message(FATAL_ERROR "Could not find corejs_abi headers under: ${SPECSNDK_SNAP_INCLUDE}")
endif()

if(NOT CMAKE_TOOLCHAIN_FILE)
  set(CMAKE_TOOLCHAIN_FILE "${SPECSNDK_TOOLCHAIN_FILE}" CACHE FILEPATH "SpecsNDK toolchain file")
endif()

project({{MODULE_NAME}})

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library({{MODULE_NAME}} SHARED
  {{MODULE_NAME}}.cpp
  {{MODULE_NAME}}.hpp
  HostFunctionWrapper.hpp
)

target_include_directories({{MODULE_NAME}} PRIVATE
  "${SPECSNDK_SNAP_INCLUDE}"
)
