use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = PathBuf::from("src/proto");
    std::fs::create_dir_all(&out_dir)?;

    prost_build::Config::new()
        .out_dir(&out_dir)
        .bytes(["."])
        .compile_protos(
            &["../../../protobufs/drivers/arduino-pro-4g-gnss/arduino_pro_4g_gnss.proto"],
            &["../../../protobufs/drivers/arduino-pro-4g-gnss"],
        )?;

    println!(
        "cargo:rerun-if-changed=../../../protobufs/drivers/arduino-pro-4g-gnss/arduino_pro_4g_gnss.proto"
    );

    Ok(())
}
