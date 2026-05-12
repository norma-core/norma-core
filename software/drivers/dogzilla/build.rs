fn main() -> Result<(), Box<dyn std::error::Error>> {
    prost_build::Config::new().compile_protos(
        &["../../../protobufs/drivers/dogzilla/dogzilla.proto"],
        &["../../../protobufs"],
    )?;
    Ok(())
}
