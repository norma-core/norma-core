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

    build_vp8()?;

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

/// VP8 goes through a C shim over libvpx. libvpx is built here from the
/// vendored VP8-only, plain-C subset (vendor/update-libvpx.sh), so release
/// binaries carry it statically for every target; the `system-libvpx`
/// feature links an installed libvpx through pkg-config instead.
fn build_vp8() -> Result<()> {
    let mut shim = cc::Build::new();
    shim.file("src/codec/vp8_shim.c").warnings(true);
    println!("cargo:rerun-if-changed=src/codec/vp8_shim.c");

    if env::var_os("CARGO_FEATURE_SYSTEM_LIBVPX").is_some() {
        let vpx = pkg_config::Config::new()
            .atleast_version("1.8")
            .probe("vpx")
            .map_err(std::io::Error::other)?;
        shim.includes(&vpx.include_paths).compile("nc_vp8");
        return Ok(());
    }

    let root = PathBuf::from("vendor/libvpx");
    let sources = std::fs::read_to_string(root.join("sources.txt"))?;
    // The shim goes first: a static linker resolves left to right.
    shim.include(root.join("config"))
        .include(&root)
        .compile("nc_vp8");
    let mut vpx = cc::Build::new();
    vpx.include(root.join("config"))
        .include(&root)
        .define("_FORTIFY_SOURCE", "0")
        .define("_LARGEFILE_SOURCE", None)
        .define("_FILE_OFFSET_BITS", "64")
        // An unoptimised encoder makes debug builds and tests crawl.
        .opt_level(2)
        .warnings(false);
    for source in sources.lines().filter(|l| !l.is_empty()) {
        let path = if source == "vpx_config.c" {
            root.join("config").join(source)
        } else {
            root.join(source)
        };
        vpx.file(path);
    }
    vpx.compile("vpx");
    println!("cargo:rerun-if-changed=vendor/libvpx");

    Ok(())
}
