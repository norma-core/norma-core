use std::env;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=PKG_CONFIG_PATH");
    println!("cargo:rerun-if-env-changed=LIBCAMERA_LIB_DIR");
    println!("cargo:rerun-if-changed=wrapper.hpp");
    println!("cargo:rerun-if-changed=wrapper.cpp");

    // Try to find libcamera via pkg-config (for include paths)
    let mut pkg_config = pkg_config::Config::new();
    pkg_config.cargo_metadata(false); // Don't auto-add link flags

    let libcamera = pkg_config
        .probe("libcamera")
        .expect("Failed to find libcamera via pkg-config. Ensure libcamera is installed or PKG_CONFIG_PATH is set.");

    let target = env::var("TARGET").unwrap_or_default();
    let host = env::var("HOST").unwrap_or_default();
    let is_cross = target != host && target.contains("linux") && !host.contains("linux");

    if is_cross {
        // Cross-compiling from non-Linux (e.g. macOS with cargo-zigbuild).
        //
        // Zig uses libc++ which is ABI-incompatible with GCC's libstdc++ used
        // to build libcamera. We use a pre-built static wrapper compiled with
        // GCC (via `make build-libcamera`). The wrapper is relocatable-linked
        // with libstdc++ so all C++ symbols are resolved internally. Only
        // libcamera and glibc symbols remain for the final link.
        let lib_dir = env::var("LIBCAMERA_LIB_DIR").unwrap_or_else(|_| {
            panic!(
                "Cross-compiling but LIBCAMERA_LIB_DIR not set. \
                 Set it to the directory containing the pre-built libcamera libraries."
            );
        });

        let wrapper_lib = Path::new(&lib_dir).join("libcamera_wrapper.a");
        if !wrapper_lib.exists() {
            panic!(
                "Cross-compiling but pre-built wrapper not found at {}. \
                 Run `make build-libcamera` in shared/libcamera/ first.",
                wrapper_lib.display()
            );
        }

        println!("cargo:rustc-link-search=native={}", lib_dir);
        println!("cargo:rustc-link-lib=static=camera_wrapper");
    } else {
        // Native build (e.g. on the Pi itself): compile wrapper with system compiler.
        let mut build = cc::Build::new();
        build
            .cpp(true)
            .std("c++17")
            .file("wrapper.cpp")
            .warnings(false);

        for path in &libcamera.include_paths {
            build.include(path);
        }

        build.compile("camera_wrapper");
    }

    // Dynamic linking to libcamera (resolved from system at runtime)
    for path in &libcamera.link_paths {
        println!("cargo:rustc-link-search=native={}", path.display());
    }
    if let Ok(lib_dir) = env::var("LIBCAMERA_LIB_DIR") {
        println!("cargo:rustc-link-search=native={}", lib_dir);
    }
    for lib in &libcamera.libs {
        println!("cargo:rustc-link-lib={}", lib);
    }

    // Transitive shared lib support (libpisp)
    if let Ok(lib_dir) = env::var("LIBCAMERA_LIB_DIR") {
        println!("cargo:rustc-link-arg=-Wl,-rpath-link,{}", lib_dir);

        let libpisp_present = ["libpisp.so", "libpisp.so.1", "libpisp.so.1.3.0"]
            .iter()
            .any(|name| Path::new(&lib_dir).join(name).exists());
        if libpisp_present {
            println!("cargo:rustc-link-lib=dylib=pisp");
        }
    }

    // Generate bindings
    let mut builder = bindgen::Builder::default()
        .header("wrapper.hpp")
        .allowlist_function("lc_.*")
        .allowlist_type("lc_.*")
        .allowlist_var("LC_.*")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()));

    for path in &libcamera.include_paths {
        builder = builder.clang_arg(format!("-I{}", path.display()));
    }

    let bindings = builder.generate().expect("Unable to generate bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write bindings!");
}
