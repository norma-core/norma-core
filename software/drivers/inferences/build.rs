use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    // Build inference protobufs used by frame formats.
    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/inferences/normvla.proto"],
            &["../../../protobufs/drivers/inferences"],
        )?;

    println!("cargo:rerun-if-changed=../../../protobufs/drivers/inferences/normvla.proto");
    Ok(())
}
