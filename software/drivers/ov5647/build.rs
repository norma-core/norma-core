fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_files = [
        "../../../protobufs/drivers/ov5647/ov5647.proto",
        "../../../protobufs/station/drivers.proto",
    ];

    prost_build::compile_protos(
        &proto_files,
        &["../../../protobufs/", "../../../protobufs/drivers/"],
    )?;

    Ok(())
}
