use std::{env, io::Result, path::PathBuf};

fn main() -> Result<()> {
    let out_dir = PathBuf::from("src/proto");

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/hikmicro/hikmicro.proto"],
            &["../../../protobufs/drivers"],
        )?;

    println!("cargo:rerun-if-changed=../../../protobufs/drivers/hikmicro/hikmicro.proto");

    let target = env::var("TARGET").unwrap_or_default();
    if !target.contains("linux") {
        println!("cargo:warning=hikmicro-thermal only captures on Linux");
    }

    Ok(())
}
