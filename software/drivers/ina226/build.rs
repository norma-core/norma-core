use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/ina226/ina226.proto"],
            &["../../../protobufs/drivers/ina226"],
        )?;

    println!("cargo:rerun-if-changed=../../../protobufs/drivers/ina226/ina226.proto");

    Ok(())
}
