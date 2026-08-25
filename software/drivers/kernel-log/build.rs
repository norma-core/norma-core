use std::io::Result;
use std::path::PathBuf;

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/kernel-log/kernel_log.proto"],
            &["../../../protobufs/drivers"],
        )?;

    println!("cargo:rerun-if-changed=../../../protobufs/drivers/kernel-log/kernel_log.proto");

    Ok(())
}
