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
