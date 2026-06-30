use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    // Build station protobufs
    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &[
                "../../../../protobufs/station/opts.proto",
                "../../../../protobufs/station/envelope.proto",
                "../../../../protobufs/station/drivers.proto",
                "../../../../protobufs/station/commands.proto",
                "../../../../protobufs/station/inference.proto",
            ],
            &["../../../../protobufs/station/"],
        )?;

    // Rerun if station protobufs change
    println!("cargo:rerun-if-changed=../../../../protobufs/station/opts.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/envelope.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/drivers.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/commands.proto");
    println!("cargo:rerun-if-changed=../../../../protobufs/station/inference.proto");

    Ok(())
}
