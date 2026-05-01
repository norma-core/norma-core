fn main() {
    let proto_files = [
        "../../../protobufs/drivers/ov5647/ov5647.proto",
        "../../../protobufs/station/drivers.proto",
    ];

    prost_build::compile_protos(&proto_files, &["../../../protobufs/", "../../../protobufs/drivers/"])
        .expect("Failed to compile protobufs");
}
