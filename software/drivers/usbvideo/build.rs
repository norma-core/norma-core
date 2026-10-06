use std::env;
use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    let target = env::var("TARGET").unwrap();

    // Build station protobufs
    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &[
                "../../../protobufs/drivers/usbvideo/frame.proto",
                "../../../protobufs/drivers/usbvideo/usbvideo.proto",
            ],
            &["../../../protobufs/drivers"],
        )?;

    // Rerun if station protobufs change
    println!("cargo:rerun-if-changed=../../../protobufs/drivers/usbvideo/frame.proto");
    println!("cargo:rerun-if-changed=../../../protobufs/drivers/usbvideo/usbvideo.proto");

    // VP8 goes through a C shim built against the installed libvpx headers;
    // set PKG_CONFIG_ALL_STATIC=1 to link libvpx statically.
    let vpx = pkg_config::Config::new()
        .atleast_version("1.8")
        .probe("vpx")
        .map_err(std::io::Error::other)?;
    cc::Build::new()
        .file("src/codec/vp8_shim.c")
        .includes(&vpx.include_paths)
        .warnings(true)
        .compile("nc_vp8");
    println!("cargo:rerun-if-changed=src/codec/vp8_shim.c");

    if target.contains("apple") {
        // Get the directory of the Cargo.toml file
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
        let lib_path = PathBuf::from(&manifest_dir).join("src/osx/avflib/lib");
        let header_path = PathBuf::from(&manifest_dir).join("src/osx/avflib/avflib/avf.h");

        // Link with the static library
        println!("cargo:rustc-link-search=native={}", lib_path.display());
        println!("cargo:rustc-link-lib=static=avf");

        // Link with macOS frameworks
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreVideo");
        println!("cargo:rustc-link-lib=framework=Foundation");

        // Rerun if the library changes
        println!(
            "cargo:rerun-if-changed={}",
            lib_path.join("libavf.a").display()
        );
        println!("cargo:rerun-if-changed={}", header_path.display());
    }

    Ok(())
}
