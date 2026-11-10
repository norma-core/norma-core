idf_component_register(SRCS "main.cpp" "net.cpp" "camera.cpp" "detector.cpp" "web.cpp" "sys.cpp" "ota.cpp"
                            "light.cpp" "servo.cpp" "search.cpp" "mcp.cpp"
    INCLUDE_DIRS "."
    REQUIRES esp_http_server esp_wifi esp_netif nvs_flash json esp_timer esp_driver_tsens esp_driver_uart app_update
            esp_app_format esp32-camera coco_detect mdns led_strip mbedtls)

# Per-lamp settings in local_config.h (git ignores it; see local_config.example.h). The glob is re-checked at every
# build, so creating or deleting the file re-runs CMake, and the changed define makes every source recompile: without
# this the first build after creating the file would keep the old objects (the compiler never saw the file, so it is
# not in their dependency lists). Later edits of an existing file are picked up by the normal dependency tracking.
file(GLOB LOCAL_CONFIG CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/local_config.h")
if(LOCAL_CONFIG)
    target_compile_definitions(${COMPONENT_LIB} PRIVATE HAVE_LOCAL_CONFIG=1)
    message(STATUS "nc_lamp: using main/local_config.h")
else()
    message(STATUS "nc_lamp: no main/local_config.h, config.h defaults (Wi-Fi placeholders, no camera)")
endif()
