use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/arduino-nicla-sense-me/arduino_nicla_sense_me.proto"],
            &["../../../protobufs/drivers/arduino-nicla-sense-me"],
        )?;

    println!(
        "cargo:rerun-if-changed=../../../protobufs/drivers/arduino-nicla-sense-me/arduino_nicla_sense_me.proto"
    );

    Ok(())
}
