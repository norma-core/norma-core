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
/// vendored VP8-only subset (vendor/update-libvpx.sh), so release binaries
/// carry it statically for every target; the `system-libvpx` feature links
/// an installed libvpx through pkg-config instead.
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
    let config = root.join("config").join(libvpx_config());
    println!("cargo:rerun-if-changed=vendor/libvpx");
    println!("cargo:rerun-if-env-changed=USBVIDEO_LIBVPX_CONFIG");

    // The shim goes first: a static linker resolves left to right.
    shim.include(&config).include(&root).compile("nc_vp8");

    let sources = std::fs::read_to_string(config.join("sources.txt"))?;
    let base = || {
        let mut b = cc::Build::new();
        b.include(&config)
            .include(&root)
            .define("_FORTIFY_SOURCE", "0")
            .define("_LARGEFILE_SOURCE", None)
            .define("_FILE_OFFSET_BITS", "64")
            // An unoptimised encoder makes debug builds and tests crawl.
            .opt_level(2)
            .warnings(false);
        b
    };
    // libvpx gives each intrinsics file the instruction set its suffix names;
    // the rest runs on the baseline, and the CPU is checked at runtime.
    let mut by_flag: Vec<(Option<&str>, cc::Build)> = Vec::new();
    let mut objects = Vec::new();
    for source in sources.lines().filter(|l| !l.is_empty()) {
        if source.ends_with(".asm") {
            objects.push(assemble(&root, &config, source)?);
            continue;
        }
        let flag = [
            ("_sse2.c", "-msse2"),
            ("_ssse3.c", "-mssse3"),
            ("_sse4.c", "-msse4.1"),
            ("_avx2.c", "-mavx2"),
            ("_avx.c", "-mavx"),
        ]
        .iter()
        .find(|(suffix, _)| source.ends_with(suffix))
        .map(|(_, flag)| *flag);
        let path = if source == "vpx_config.c" {
            config.join(source)
        } else {
            root.join(source)
        };
        match by_flag.iter_mut().find(|(f, _)| *f == flag) {
            Some((_, build)) => {
                build.file(path);
            }
            None => {
                let mut build = base();
                if let Some(flag) = flag {
                    build.flag(flag);
                }
                build.file(path);
                by_flag.push((flag, build));
            }
        }
    }
    for (_, build) in &by_flag {
        objects.extend(build.compile_intermediates());
    }
    cc::Build::new().objects(objects).compile("vpx");
    Ok(())
}

/// The vendored configuration for this target. x86_64 needs nasm for its
/// assembly; without it, and on other targets, the plain C build is used.
fn libvpx_config() -> &'static str {
    if let Ok(name) = env::var("USBVIDEO_LIBVPX_CONFIG") {
        return match name.as_str() {
            "arm64" => "arm64",
            "x86_64" => "x86_64",
            _ => "generic",
        };
    }
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    match (arch.as_str(), os.as_str()) {
        ("aarch64", "linux" | "macos") => "arm64",
        ("x86_64", "linux") if nasm().is_some() => "x86_64",
        ("x86_64", "linux") => {
            println!("cargo:warning=nasm not found: libvpx is built without SIMD");
            "generic"
        }
        _ => "generic",
    }
}

fn nasm() -> Option<String> {
    let nasm = env::var("NASM").unwrap_or_else(|_| "nasm".into());
    std::process::Command::new(&nasm)
        .arg("-v")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|_| nasm)
}

fn assemble(root: &std::path::Path, config: &std::path::Path, source: &str) -> Result<PathBuf> {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap())
        .join("vpx-asm")
        .join(format!("{source}.o"));
    std::fs::create_dir_all(out.parent().unwrap())?;
    let status = std::process::Command::new(nasm().ok_or_else(|| std::io::Error::other("nasm"))?)
        .args(["-f", "elf64"])
        .arg(format!("-I{}/", config.display()))
        .arg(format!("-I{}/", root.display()))
        .arg("-o")
        .arg(&out)
        .arg(root.join(source))
        .status()?;
    if !status.success() {
        return Err(std::io::Error::other(format!("nasm failed on {source}")));
    }
    Ok(out)
}
