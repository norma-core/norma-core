cmake_minimum_required(VERSION 3.16)

project(pwm_output_firmware C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_library(pwm_output_firmware_core
  pwm_output_m4/src/protocol.c
  pwm_output_m4/src/wave_engine.c
  pwm_output_m4/src/gremlin.c
)

target_include_directories(pwm_output_firmware_core
  PUBLIC
    pwm_output_m4/src
)

if(CMAKE_C_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(pwm_output_firmware_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

enable_testing()

add_executable(pwm_output_firmware_tests
  tests/firmware_tests.c
)

target_link_libraries(pwm_output_firmware_tests PRIVATE pwm_output_firmware_core)

if(CMAKE_C_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(pwm_output_firmware_tests PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_test(NAME pwm_output_firmware_tests COMMAND pwm_output_firmware_tests)
