use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/victron-smartsolar-mppt/victron_smartsolar_mppt.proto"],
            &["../../../protobufs/drivers/victron-smartsolar-mppt"],
        )?;

    println!(
        "cargo:rerun-if-changed=../../../protobufs/drivers/victron-smartsolar-mppt/victron_smartsolar_mppt.proto"
    );

    Ok(())
}
