use std::io::Result;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    // Build station protobufs
    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &[
                "../../../../protobufs/station/opts.proto",
                "../../../../protobufs/station/drivers.proto",
                "../../../../protobufs/station/commands.proto",
                "../../../../protobufs/station/startups.proto",
                "../../../../protobufs/station/inference_tags.proto",
            ],
            &["../../../../protobufs/station/"],
        )?;

    // Rerun if station protobufs change
    println!("cargo:rerun-if-changed=../../../../protobufs/station/opts.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/drivers.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/commands.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/startups.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/inference_tags.proto");

    // Rerun if client files change
    let client_index = Path::new("../../clients/station-viewer/dist/index.html");
    if client_index.exists() {
        println!("cargo:rerun-if-changed=../../clients/station-viewer/dist/index.html");
    }

    // Get git commit hash
    let git_hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=GIT_HASH={}", git_hash);

    Ok(())
}
