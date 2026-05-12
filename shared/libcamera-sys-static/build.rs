use std::env;
use std::error::Error;
use std::path::{Path, PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=PKG_CONFIG_PATH");
    println!("cargo:rerun-if-env-changed=LIBCAMERA_LIB_DIR");
    println!("cargo:rerun-if-changed=wrapper.hpp");
    println!("cargo:rerun-if-changed=wrapper.cpp");

    let mut pkg_config = pkg_config::Config::new();
    pkg_config.cargo_metadata(false);

    let libcamera = pkg_config
        .probe("libcamera")
        .map_err(|e| build_error(format!("failed to find libcamera via pkg-config: {e}")))?;

    let target = env::var("TARGET").unwrap_or_default();
    let host = env::var("HOST").unwrap_or_default();
    let is_cross = target != host && target.contains("linux") && !host.contains("linux");

    if is_cross {
        let lib_dir = env::var("LIBCAMERA_LIB_DIR").map_err(|_| {
            build_error("cross-compiling requires LIBCAMERA_LIB_DIR with pre-built libcamera libs")
        })?;
        let wrapper_lib = Path::new(&lib_dir).join("libcamera_wrapper.a");

        if !wrapper_lib.exists() {
            return Err(build_error(format!(
                "pre-built wrapper not found at {}",
                wrapper_lib.display()
            )));
        }

        println!("cargo:rustc-link-search=native={lib_dir}");
        println!("cargo:rustc-link-lib=static=camera_wrapper");
    } else {
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

    for path in &libcamera.link_paths {
        println!("cargo:rustc-link-search=native={}", path.display());
    }
    if let Ok(lib_dir) = env::var("LIBCAMERA_LIB_DIR") {
        println!("cargo:rustc-link-search=native={lib_dir}");
        println!("cargo:rustc-link-arg=-Wl,-rpath-link,{lib_dir}");

        let libpisp_present = ["libpisp.so", "libpisp.so.1", "libpisp.so.1.3.0"]
            .iter()
            .any(|name| Path::new(&lib_dir).join(name).exists());
        if libpisp_present {
            println!("cargo:rustc-link-lib=dylib=pisp");
        }
    }
    for lib in &libcamera.libs {
        println!("cargo:rustc-link-lib={lib}");
    }

    let mut builder = bindgen::Builder::default()
        .header("wrapper.hpp")
        .allowlist_function("lc_.*")
        .allowlist_type("lc_.*")
        .allowlist_var("LC_.*")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()));

    for path in &libcamera.include_paths {
        builder = builder.clang_arg(format!("-I{}", path.display()));
    }

    let bindings = builder
        .generate()
        .map_err(|e| build_error(format!("failed to generate bindings: {e}")))?;
    let out_path = PathBuf::from(
        env::var("OUT_DIR").map_err(|e| build_error(format!("OUT_DIR is not set: {e}")))?,
    );

    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .map_err(|e| build_error(format!("failed to write bindings: {e}")))?;

    Ok(())
}

fn build_error(message: impl Into<String>) -> Box<dyn Error> {
    std::io::Error::other(message.into()).into()
}
