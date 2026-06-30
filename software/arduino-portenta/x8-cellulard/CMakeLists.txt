cmake_minimum_required(VERSION 3.22)

project(x8_cellulard
  VERSION 0.1.0
  DESCRIPTION "Portenta X8 cellular supervisor daemon"
  LANGUAGES C)

include(GNUInstallDirs)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(PkgConfig REQUIRED)

pkg_check_modules(X8_CELLULARD_DEPS REQUIRED IMPORTED_TARGET
  glib-2.0
  gio-2.0
  mm-glib
  libgpiod
  libnl-3.0
  libnl-route-3.0)

add_executable(x8-cellulard
  src/config.c
  src/config.h
  src/gpio_power.c
  src/gpio_power.h
  src/health.c
  src/health.h
  src/mm.c
  src/mm.h
  src/ppp.c
  src/ppp.h
  src/route.c
  src/route.h
  src/main.c)

target_link_libraries(x8-cellulard
  PRIVATE
    PkgConfig::X8_CELLULARD_DEPS)

target_compile_options(x8-cellulard
  PRIVATE
    $<$<C_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic>)

install(TARGETS x8-cellulard
  RUNTIME DESTINATION ${CMAKE_INSTALL_SBINDIR})
