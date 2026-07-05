use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/airgradient-open-air-o-1pst/airgradient_open_air_o_1pst.proto"],
            &["../../../protobufs/drivers/airgradient-open-air-o-1pst"],
        )?;

    println!(
        "cargo:rerun-if-changed=../../../protobufs/drivers/airgradient-open-air-o-1pst/airgradient_open_air_o_1pst.proto"
    );

    Ok(())
}
