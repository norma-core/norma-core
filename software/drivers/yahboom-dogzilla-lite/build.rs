fn main() -> Result<(), Box<dyn std::error::Error>> {
    prost_build::Config::new().compile_protos(
        &["../../../protobufs/drivers/yahboom-dogzilla-lite/yahboom_dogzilla_lite.proto"],
        &["../../../protobufs"],
    )?;
    Ok(())
}
