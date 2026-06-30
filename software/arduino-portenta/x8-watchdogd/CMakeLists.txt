cmake_minimum_required(VERSION 3.22)

project(x8_watchdogd
  VERSION 0.1.0
  DESCRIPTION "Portenta X8 network watchdog daemon"
  LANGUAGES C)

include(GNUInstallDirs)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(x8-watchdogd
  src/main.c)

target_compile_options(x8-watchdogd
  PRIVATE
    $<$<C_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic>)

install(TARGETS x8-watchdogd
  RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR})
