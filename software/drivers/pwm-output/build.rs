use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/pwm-output/pwm_output.proto"],
            &["../../../protobufs/drivers/pwm-output"],
        )?;

    println!("cargo:rerun-if-changed=../../../protobufs/drivers/pwm-output/pwm_output.proto");

    Ok(())
}
