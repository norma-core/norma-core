fn main() -> Result<(), Box<dyn std::error::Error>> {
    prost_build::Config::new()
        .out_dir("src/proto")
        .compile_protos(
            &["../../../protobufs/drivers/dogzilla/dogzilla.proto"],
            &["../../../protobufs"],
        )?;
    Ok(())
}
