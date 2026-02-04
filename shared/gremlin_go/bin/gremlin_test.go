package main

import (
	"bytes"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/norma-core/norma-core/shared/gremlin_go/bin/testdata"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/testpb/map_test"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/testpb/protobuf_unittest"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/testpb/protobuf_unittest_import"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/testpb/test"
)

func TestGoldenMessage(t *testing.T) {
	parsed := &protobuf_unittest.TestAllTypesReader{}
	content := getTestFileContent("golden_message")
	if err := parsed.Unmarshal(content); err != nil {
		t.Errorf("failed to unmarshal golden message: %v", err)
	}

	checkParsedGoldenMessage(t, parsed)
}

func BenchmarkUnmarshalGremlin(b *testing.B) {
	content := getTestFileContent("golden_message")
	for i := 0; i < b.N; i++ {
		parsed := protobuf_unittest.NewTestAllTypesReader()
		if err := parsed.Unmarshal(content); err != nil {
			b.Errorf("failed to unmarshal golden message: %v", err)
		}
	}
}

func checkParsedGoldenMessage(t *testing.T, parsed *protobuf_unittest.TestAllTypesReader) {
	// Check that the message is parsed correctly.
	// Original message is in testdata/golden_message.
	// Expected results:
	// https://github.com/protocolbuffers/protobuf/blob/main/objectivec/Tests/text_format_unittest_data.txt

	if parsed.GetOptionalInt32() != 101 {
		t.Errorf("optional_int32: got %v, want %v", parsed.GetOptionalInt32(), 101)
	}

	if parsed.GetOptionalInt64() != 102 {
		t.Errorf("optional_int64: got %v, want %v", parsed.GetOptionalInt64(), 102)
	}

	if parsed.GetOptionalUint32() != 103 {
		t.Errorf("optional_uint32: got %v, want %v", parsed.GetOptionalUint32(), 103)
	}

	if parsed.GetOptionalUint64() != 104 {
		t.Errorf("optional_uint64: got %v, want %v", parsed.GetOptionalUint64(), 104)
	}

	if parsed.GetOptionalSint32() != 105 {
		t.Errorf("optional_sint32: got %v, want %v", parsed.GetOptionalSint32(), 105)
	}

	if parsed.GetOptionalSint64() != 106 {
		t.Errorf("optional_sint64: got %v, want %v", parsed.GetOptionalSint64(), 106)
	}

	if parsed.GetOptionalFixed32() != 107 {
		t.Errorf("optional_fixed32: got %v, want %v", parsed.GetOptionalFixed32(), 107)
	}

	if parsed.GetOptionalFixed64() != 108 {
		t.Errorf("optional_fixed64: got %v, want %v", parsed.GetOptionalFixed64(), 108)
	}

	if parsed.GetOptionalSfixed32() != 109 {
		t.Errorf("optional_sfixed32: got %v, want %v", parsed.GetOptionalSfixed32(), 109)
	}

	if parsed.GetOptionalSfixed64() != 110 {
		t.Errorf("optional_sfixed64: got %v, want %v", parsed.GetOptionalSfixed64(), 110)
	}

	if parsed.GetOptionalFloat() != 111 {
		t.Errorf("optional_float: got %v, want %v", parsed.GetOptionalFloat(), 111)
	}

	if parsed.GetOptionalDouble() != 112 {
		t.Errorf("optional_double: got %v, want %v", parsed.GetOptionalDouble(), 112)
	}

	if parsed.GetOptionalBool() != true {
		t.Errorf("optional_bool: got %v, want %v", parsed.GetOptionalBool(), true)
	}

	if parsed.GetOptionalString() != "115" {
		t.Errorf("optional_string: got %v, want %v", parsed.GetOptionalString(), "115")
	}

	if !bytes.Equal(parsed.GetOptionalBytes(), []byte("116")) {
		t.Errorf("optional_bytes: got %v, want %v", parsed.GetOptionalBytes(), []byte("116"))
	}

	if parsed.GetOptionalNestedMessage().GetBb() != 118 {
		t.Errorf("optional_nested_message.bb: got %v, want %v", parsed.GetOptionalNestedMessage().GetBb(), 118)
	}

	if parsed.GetOptionalForeignMessage().GetC() != 119 {
		t.Errorf("optional_foreign_message.c: got %v, want %v", parsed.GetOptionalForeignMessage().GetC(), 119)
	}

	if parsed.GetOptionalImportMessage().GetD() != 120 {
		t.Errorf("optional_import_message.d: got %v, want %v", parsed.GetOptionalImportMessage().GetD(), 120)
	}

	if parsed.GetOptionalPublicImportMessage().GetE() != 126 {
		t.Errorf("optional_public_import_message.e: got %v, want %v", parsed.GetOptionalPublicImportMessage().GetE(), 126)
	}

	if parsed.GetOptionalLazyMessage().GetBb() != 127 {
		t.Errorf("optional_lazy_message.bb: got %v, want %v", parsed.GetOptionalLazyMessage().GetBb(), 127)
	}

	if parsed.GetOptionalUnverifiedLazyMessage().GetBb() != 128 {
		t.Errorf("optional_unverified_lazy_message.bb: got %v, want %v", parsed.GetOptionalUnverifiedLazyMessage().GetBb(), 128)
	}

	if parsed.GetOptionalNestedEnum() != protobuf_unittest.TestAllTypes_BAZ {
		t.Errorf("optional_nested_enum: got %v, want %v", parsed.GetOptionalNestedEnum(), protobuf_unittest.TestAllTypes_BAZ)
	}

	if parsed.GetOptionalForeignEnum() != protobuf_unittest.ForeignEnum_FOREIGN_BAZ {
		t.Errorf("optional_foreign_enum: got %v, want %v", parsed.GetOptionalForeignEnum(), protobuf_unittest.ForeignEnum_FOREIGN_BAZ)
	}

	if parsed.GetOptionalImportEnum() != protobuf_unittest_import.ImportEnum_IMPORT_BAZ {
		t.Errorf("optional_import_enum: got %v, want %v", parsed.GetOptionalImportEnum(), protobuf_unittest_import.ImportEnum_IMPORT_BAZ)
	}

	if parsed.GetOptionalStringPiece() != "124" {
		t.Errorf("optional_string_piece: got %v, want %v", parsed.GetOptionalStringPiece(), "124")
	}

	if parsed.GetOptionalCord() != "125" {
		t.Errorf("optional_cord: got %v, want %v", parsed.GetOptionalCord(), "125")
	}

	if !cmp.Equal(parsed.GetRepeatedInt32(), []int32{201, 301}) {
		t.Errorf("repeated_int32: got %v, want %v", parsed.GetRepeatedInt32(), []int32{201, 301})
	}

	if !cmp.Equal(parsed.GetRepeatedInt64(), []int64{202, 302}) {
		t.Errorf("repeated_int64: got %v, want %v", parsed.GetRepeatedInt64(), []int64{202, 302})
	}

	if !cmp.Equal(parsed.GetRepeatedUint32(), []uint32{203, 303}) {
		t.Errorf("repeated_uint32: got %v, want %v", parsed.GetRepeatedUint32(), []uint32{203, 303})
	}

	if !cmp.Equal(parsed.GetRepeatedUint64(), []uint64{204, 304}) {
		t.Errorf("repeated_uint64: got %v, want %v", parsed.GetRepeatedUint64(), []uint64{204, 304})
	}

	if !cmp.Equal(parsed.GetRepeatedSint32(), []int32{205, 305}) {
		t.Errorf("repeated_sint32: got %v, want %v", parsed.GetRepeatedSint32(), []int32{205, 305})
	}

	if !cmp.Equal(parsed.GetRepeatedSint64(), []int64{206, 306}) {
		t.Errorf("repeated_sint64: got %v, want %v", parsed.GetRepeatedSint64(), []int64{206, 306})
	}

	if !cmp.Equal(parsed.GetRepeatedFixed32(), []uint32{207, 307}) {
		t.Errorf("repeated_fixed32: got %v, want %v", parsed.GetRepeatedFixed32(), []uint32{207, 307})
	}

	if !cmp.Equal(parsed.GetRepeatedFixed64(), []uint64{208, 308}) {
		t.Errorf("repeated_fixed64: got %v, want %v", parsed.GetRepeatedFixed64(), []uint64{208, 308})
	}

	if !cmp.Equal(parsed.GetRepeatedSfixed32(), []int32{209, 309}) {
		t.Errorf("repeated_sfixed32: got %v, want %v", parsed.GetRepeatedSfixed32(), []int32{209, 309})
	}

	if !cmp.Equal(parsed.GetRepeatedSfixed64(), []int64{210, 310}) {
		t.Errorf("repeated_sfixed64: got %v, want %v", parsed.GetRepeatedSfixed64(), []int64{210, 310})
	}

	if !cmp.Equal(parsed.GetRepeatedFloat(), []float32{211, 311}) {
		t.Errorf("repeated_float: got %v, want %v", parsed.GetRepeatedFloat(), []float32{211, 311})
	}

	if !cmp.Equal(parsed.GetRepeatedDouble(), []float64{212, 312}) {
		t.Errorf("repeated_double: got %v, want %v", parsed.GetRepeatedDouble(), []float64{212, 312})
	}

	if !cmp.Equal(parsed.GetRepeatedBool(), []bool{true, false}) {
		t.Errorf("repeated_bool: got %v, want %v", parsed.GetRepeatedBool(), []bool{true, false})
	}

	if !cmp.Equal(parsed.GetRepeatedString(), []string{"215", "315"}) {
		t.Errorf("repeated_string: got %v, want %v", parsed.GetRepeatedString(), []string{"215", "315"})
	}

	if !cmp.Equal(parsed.GetRepeatedBytes(), [][]byte{[]byte("216"), []byte("316")}) {
		t.Errorf("repeated_bytes: got %v, want %v", parsed.GetRepeatedBytes(), [][]byte{[]byte("216"), []byte("316")})
	}

	if len(parsed.GetRepeatedNestedMessage()) != 2 {
		t.Errorf("repeated_nested_message: got %v, want %v", len(parsed.GetRepeatedNestedMessage()), 2)
	}

	if parsed.GetRepeatedNestedMessage()[0].GetBb() != 218 {
		t.Errorf("repeated_nested_message.bb: got %v, want %v", parsed.GetRepeatedNestedMessage()[0].GetBb(), 218)
	}

	if parsed.GetRepeatedNestedMessage()[1].GetBb() != 318 {
		t.Errorf("repeated_nested_message.bb: got %v, want %v", parsed.GetRepeatedNestedMessage()[1].GetBb(), 318)
	}

	if len(parsed.GetRepeatedForeignMessage()) != 2 {
		t.Errorf("repeated_foreign_message: got %v, want %v", len(parsed.GetRepeatedForeignMessage()), 2)
	}

	if parsed.GetRepeatedForeignMessage()[0].GetC() != 219 {
		t.Errorf("repeated_foreign_message.c: got %v, want %v", parsed.GetRepeatedForeignMessage()[0].GetC(), 219)
	}

	if parsed.GetRepeatedForeignMessage()[1].GetC() != 319 {
		t.Errorf("repeated_foreign_message.c: got %v, want %v", parsed.GetRepeatedForeignMessage()[1].GetC(), 319)
	}

	if len(parsed.GetRepeatedImportMessage()) != 2 {
		t.Errorf("repeated_import_message: got %v, want %v", len(parsed.GetRepeatedImportMessage()), 2)
	}

	if parsed.GetRepeatedImportMessage()[0].GetD() != 220 {
		t.Errorf("repeated_import_message.d: got %v, want %v", parsed.GetRepeatedImportMessage()[0].GetD(), 220)
	}

	if parsed.GetRepeatedImportMessage()[1].GetD() != 320 {
		t.Errorf("repeated_import_message.d: got %v, want %v", parsed.GetRepeatedImportMessage()[1].GetD(), 320)
	}

	if len(parsed.GetRepeatedLazyMessage()) != 2 {
		t.Errorf("repeated_nested_enum: got %v, want %v", len(parsed.GetRepeatedLazyMessage()), 2)
	}

	if parsed.GetRepeatedLazyMessage()[0].GetBb() != 227 {
		t.Errorf("repeated_lazy_message.bb: got %v, want %v", parsed.GetRepeatedLazyMessage()[0].GetBb(), 227)
	}

	if parsed.GetRepeatedLazyMessage()[1].GetBb() != 327 {
		t.Errorf("repeated_lazy_message.bb: got %v, want %v", parsed.GetRepeatedLazyMessage()[1].GetBb(), 327)
	}

	if !cmp.Equal(parsed.GetRepeatedNestedEnum(),
		[]protobuf_unittest.TestAllTypes_NestedEnum{
			protobuf_unittest.TestAllTypes_BAR, protobuf_unittest.TestAllTypes_BAZ,
		}) {
		t.Errorf("repeated_nested_enum: got %v, want %v", parsed.GetRepeatedNestedEnum(), []protobuf_unittest.TestAllTypes_NestedEnum{protobuf_unittest.TestAllTypes_BAR, protobuf_unittest.TestAllTypes_BAZ})
	}

	if !cmp.Equal(parsed.GetRepeatedForeignEnum(),
		[]protobuf_unittest.ForeignEnum{
			protobuf_unittest.ForeignEnum_FOREIGN_BAR, protobuf_unittest.ForeignEnum_FOREIGN_BAZ,
		}) {
		t.Errorf("repeated_foreign_enum: got %v, want %v", parsed.GetRepeatedForeignEnum(), []protobuf_unittest.ForeignEnum{protobuf_unittest.ForeignEnum_FOREIGN_BAR, protobuf_unittest.ForeignEnum_FOREIGN_BAZ})
	}

	if !cmp.Equal(parsed.GetRepeatedImportEnum(),
		[]protobuf_unittest_import.ImportEnum{
			protobuf_unittest_import.ImportEnum_IMPORT_BAR, protobuf_unittest_import.ImportEnum_IMPORT_BAZ,
		}) {
		t.Errorf("repeated_import_enum: got %v, want %v", parsed.GetRepeatedImportEnum(), []protobuf_unittest_import.ImportEnum{protobuf_unittest_import.ImportEnum_IMPORT_BAR, protobuf_unittest_import.ImportEnum_IMPORT_BAZ})
	}

	if !cmp.Equal(parsed.GetRepeatedStringPiece(), []string{"224", "324"}) {
		t.Errorf("repeated_string_piece: got %v, want %v", parsed.GetRepeatedStringPiece(), []string{"224", "324"})
	}

	if !cmp.Equal(parsed.GetRepeatedCord(), []string{"225", "325"}) {
		t.Errorf("repeated_cord: got %v, want %v", parsed.GetRepeatedCord(), []string{"225", "325"})
	}

	if parsed.GetDefaultInt32() != 401 {
		t.Errorf("default_int32: got %v, want %v", parsed.GetDefaultInt32(), 401)
	}

	if parsed.GetDefaultInt64() != 402 {
		t.Errorf("default_int64: got %v, want %v", parsed.GetDefaultInt64(), 402)
	}

	if parsed.GetDefaultUint32() != 403 {
		t.Errorf("default_uint32: got %v, want %v", parsed.GetDefaultUint32(), 403)
	}

	if parsed.GetDefaultUint64() != 404 {
		t.Errorf("default_uint64: got %v, want %v", parsed.GetDefaultUint64(), 404)
	}

	if parsed.GetDefaultSint32() != 405 {
		t.Errorf("default_sint32: got %v, want %v", parsed.GetDefaultSint32(), 405)
	}

	if parsed.GetDefaultSint64() != 406 {
		t.Errorf("default_sint64: got %v, want %v", parsed.GetDefaultSint64(), 406)
	}

	if parsed.GetDefaultFixed32() != 407 {
		t.Errorf("default_fixed32: got %v, want %v", parsed.GetDefaultFixed32(), 407)
	}

	if parsed.GetDefaultFixed64() != 408 {
		t.Errorf("default_fixed64: got %v, want %v", parsed.GetDefaultFixed64(), 408)
	}

	if parsed.GetDefaultSfixed32() != 409 {
		t.Errorf("default_sfixed32: got %v, want %v", parsed.GetDefaultSfixed32(), 409)
	}

	if parsed.GetDefaultSfixed64() != 410 {
		t.Errorf("default_sfixed64: got %v, want %v", parsed.GetDefaultSfixed64(), 410)
	}

	if parsed.GetDefaultFloat() != 411 {
		t.Errorf("default_double: got %v, want %v", parsed.GetDefaultFloat(), 411)
	}

	if parsed.GetDefaultDouble() != 412 {
		t.Errorf("default_double: got %v, want %v", parsed.GetDefaultDouble(), 412)
	}

	if parsed.GetDefaultBool() != false {
		t.Errorf("default_bool: got %v, want %v", parsed.GetDefaultBool(), false)
	}

	if parsed.GetDefaultString() != "415" {
		t.Errorf("default_string: got %v, want %v", parsed.GetDefaultString(), "415")
	}

	if !bytes.Equal(parsed.GetDefaultBytes(), []byte("416")) {
		t.Errorf("default_bytes: got %v, want %v", parsed.GetDefaultBytes(), []byte("416"))
	}

	if parsed.GetDefaultNestedEnum() != protobuf_unittest.TestAllTypes_FOO {
		t.Errorf("default_nested_enum: got %v, want %v", parsed.GetDefaultNestedEnum(), protobuf_unittest.TestAllTypes_FOO)
	}

	if parsed.GetDefaultForeignEnum() != protobuf_unittest.ForeignEnum_FOREIGN_FOO {
		t.Errorf("default_foreign_enum: got %v, want %v", parsed.GetDefaultForeignEnum(), protobuf_unittest.ForeignEnum_FOREIGN_FOO)
	}

	if parsed.GetDefaultImportEnum() != protobuf_unittest_import.ImportEnum_IMPORT_FOO {
		t.Errorf("default_import_enum: got %v, want %v", parsed.GetDefaultImportEnum(), protobuf_unittest_import.ImportEnum_IMPORT_FOO)
	}

	if parsed.GetDefaultStringPiece() != "424" {
		t.Errorf("default_string_piece: got %v, want %v", parsed.GetDefaultStringPiece(), "424")
	}

	if parsed.GetDefaultCord() != "425" {
		t.Errorf("default_cord: got %v, want %v", parsed.GetDefaultCord(), "425")
	}

	if parsed.GetOneofUint32() != 601 {
		t.Errorf("oneof_uint32: got %v, want %v", parsed.GetOneofUint32(), 601)
	}

	if parsed.GetOneofNestedMessage().GetBb() != 602 {
		t.Errorf("oneof_nested_message: got %v, want %v", parsed.GetOneofNestedMessage().GetBb(), 602)
	}

	if parsed.GetOneofString() != "603" {
		t.Errorf("oneof_string: got %v, want %v", parsed.GetOneofString(), "603")
	}

	if !cmp.Equal(parsed.GetOneofBytes(), []byte("604")) {
		t.Errorf("oneof_bytes: got %v, want %v", parsed.GetOneofBytes(), []byte("604"))
	}
}

func TestMapParsing(t *testing.T) {
	var data = map_test.NewTestMapReader()
	if err := data.Unmarshal(getTestFileContent("map_test")); err != nil {
		t.Errorf("Unmarshal failed: %v", err)
	}
	if !cmp.Equal(data.GetInt32ToInt32Field(), map[int32]int32{100: 101, 200: 201}) {
		t.Errorf("int32_to_int32_field: got %v, want %v", data.GetInt32ToInt32Field(), map[int32]int32{100: 101, 200: 201})
	}

	if !cmp.Equal(data.GetInt32ToStringField(), map[int32]string{101: "101", 201: "201"}) {
		t.Errorf("int32_to_string_field: got %v, want %v", data.GetInt32ToStringField(), map[int32]string{101: "101", 201: "201"})
	}

	if !cmp.Equal(data.GetInt32ToBytesField(), map[int32][]byte{102: {102}, 202: {202}}) {
		t.Errorf("int32_to_bytes_field: got %v, want %v", data.GetInt32ToBytesField(), map[int32][]byte{102: {102}, 202: {202}})
	}

	if !cmp.Equal(data.GetInt32ToEnumField(), map[int32]map_test.TestMap_EnumValue{103: map_test.TestMap_FOO, 203: map_test.TestMap_BAR}) {
		t.Errorf("int32_to_enum_field: got %v, want %v", data.GetInt32ToEnumField(), map[int32]map_test.TestMap_EnumValue{103: map_test.TestMap_FOO, 203: map_test.TestMap_BAR})
	}

	if !cmp.Equal(data.GetStringToInt32Field(), map[string]int32{"105": 105, "205": 205}) {
		t.Errorf("string_to_int32_field: got %v, want %v", data.GetStringToInt32Field(), map[string]int32{"105": 105, "205": 205})
	}

	if !cmp.Equal(data.GetUint32ToInt32Field(), map[uint32]int32{106: 106, 206: 206}) {
		t.Errorf("uint32_to_int32_field: got %v, want %v", data.GetUint32ToInt32Field(), map[uint32]int32{106: 106, 206: 206})
	}

	if !cmp.Equal(data.GetInt64ToInt32Field(), map[int64]int32{107: 107, 207: 207}) {
		t.Errorf("int64_to_int32_field: got %v, want %v", data.GetInt64ToInt32Field(), map[int64]int32{107: 107, 207: 207})
	}

	m := data.GetInt32ToMessageField()
	if len(m) != 2 {
		t.Errorf("int32_to_message_field: got %v", m)
	}

	if m[104].GetValue() != 104 {
		t.Errorf("int32_to_message_field: got %v", m)
	}
	if m[204].GetValue() != 204 {
		t.Errorf("int32_to_message_field: got %v", m)
	}
}

func getTestFileContent(name string) []byte {
	content, err := testdata.TestData.ReadFile(name)
	if err != nil {
		panic(err)
	}

	return content
}

func TestRWBasic(t *testing.T) {
	msg := protobuf_unittest.TestAllTypes{
		OptionalInt32: 101,
		OptionalInt64: 102,
		OptionalNestedMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 118,
		},
	}
	content := msg.Marshal()

	parsed := protobuf_unittest.NewTestAllTypesReader()
	if err := parsed.Unmarshal(content); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}
	if parsed.GetOptionalInt32() != 101 {
		t.Errorf("optional_int32: got %v, want %v", parsed.GetOptionalInt32(), 101)
	}
	if parsed.GetOptionalInt64() != 102 {
		t.Errorf("optional_int64: got %v, want %v", parsed.GetOptionalInt64(), 102)
	}
	if parsed.GetOptionalNestedMessage().GetBb() != 118 {
		t.Errorf("optional_nested_message: got %v, want %v", parsed.GetOptionalNestedMessage().GetBb(), 118)
	}
}

func TestReadWrite(t *testing.T) {
	msg := protobuf_unittest.TestAllTypes{
		OptionalInt32:    101,
		OptionalInt64:    102,
		OptionalUint32:   103,
		OptionalUint64:   104,
		OptionalSint32:   105,
		OptionalSint64:   106,
		OptionalFixed32:  107,
		OptionalFixed64:  108,
		OptionalSfixed32: 109,
		OptionalSfixed64: 110,
		OptionalFloat:    111,
		OptionalDouble:   112,
		OptionalBool:     true,
		OptionalString:   "115",
		OptionalBytes:    []byte("116"),
		OptionalNestedMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 118,
		},
		OptionalForeignMessage: &protobuf_unittest.ForeignMessage{
			C: 119,
		},
		OptionalImportMessage: &protobuf_unittest_import.ImportMessage{
			D: 120,
		},
		OptionalPublicImportMessage: &protobuf_unittest_import.PublicImportMessage{
			E: 126,
		},
		OptionalLazyMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 127,
		},
		OptionalUnverifiedLazyMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 128,
		},
		OptionalNestedEnum:  protobuf_unittest.TestAllTypes_BAZ,
		OptionalForeignEnum: protobuf_unittest.ForeignEnum_FOREIGN_BAZ,
		OptionalImportEnum:  protobuf_unittest_import.ImportEnum_IMPORT_BAZ,
		OptionalStringPiece: "124",
		OptionalCord:        "125",
		RepeatedInt32:       []int32{201, 301},

		RepeatedInt64:    []int64{202, 302},
		RepeatedUint32:   []uint32{203, 303},
		RepeatedUint64:   []uint64{204, 304},
		RepeatedSint32:   []int32{205, 305},
		RepeatedSint64:   []int64{206, 306},
		RepeatedFixed32:  []uint32{207, 307},
		RepeatedFixed64:  []uint64{208, 308},
		RepeatedSfixed32: []int32{209, 309},
		RepeatedSfixed64: []int64{210, 310},
		RepeatedFloat:    []float32{211, 311},
		RepeatedDouble:   []float64{212, 312},
		RepeatedBool:     []bool{true, false},
		RepeatedString:   []string{"215", "315"},
		RepeatedBytes:    [][]byte{[]byte("216"), []byte("316")},

		RepeatedNestedMessage: []*protobuf_unittest.TestAllTypes_NestedMessage{
			{Bb: 218},
			{Bb: 318},
		},

		RepeatedForeignMessage: []*protobuf_unittest.ForeignMessage{
			{C: 219},
			{C: 319},
		},

		RepeatedImportMessage: []*protobuf_unittest_import.ImportMessage{
			{D: 220},
			{D: 320},
		},

		RepeatedLazyMessage: []*protobuf_unittest.TestAllTypes_NestedMessage{
			{Bb: 227},
			{Bb: 327},
		},

		RepeatedNestedEnum:  []protobuf_unittest.TestAllTypes_NestedEnum{protobuf_unittest.TestAllTypes_BAR, protobuf_unittest.TestAllTypes_BAZ},
		RepeatedForeignEnum: []protobuf_unittest.ForeignEnum{protobuf_unittest.ForeignEnum_FOREIGN_BAR, protobuf_unittest.ForeignEnum_FOREIGN_BAZ},
		RepeatedImportEnum:  []protobuf_unittest_import.ImportEnum{protobuf_unittest_import.ImportEnum_IMPORT_BAR, protobuf_unittest_import.ImportEnum_IMPORT_BAZ},
		RepeatedStringPiece: []string{"224", "324"},
		RepeatedCord:        []string{"225", "325"},
		DefaultInt32:        401,
		DefaultInt64:        402,
		DefaultUint32:       403,
		DefaultUint64:       404,
		DefaultSint32:       405,
		DefaultSint64:       406,
		DefaultFixed32:      407,
		DefaultFixed64:      408,
		DefaultSfixed32:     409,
		DefaultSfixed64:     410,
		DefaultFloat:        411,
		DefaultDouble:       412,
		DefaultBool:         false,
		DefaultString:       "415",
		DefaultBytes:        []byte("416"),
		DefaultNestedEnum:   protobuf_unittest.TestAllTypes_FOO,
		DefaultForeignEnum:  protobuf_unittest.ForeignEnum_FOREIGN_FOO,
		DefaultImportEnum:   protobuf_unittest_import.ImportEnum_IMPORT_FOO,
		DefaultStringPiece:  "424",
		DefaultCord:         "425",
		OneofUint32:         601,
		OneofNestedMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 602,
		},
		OneofString: "603",
		OneofBytes:  []byte("604"),
	}

	content := msg.Marshal()

	parsed := protobuf_unittest.NewTestAllTypesReader()
	if err := parsed.Unmarshal(content); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}

	checkParsedGoldenMessage(t, parsed)
}

func TestNilList(t *testing.T) {
	gMsg := protobuf_unittest.TestAllTypes{
		RepeatedLazyMessage: []*protobuf_unittest.TestAllTypes_NestedMessage{
			nil, {Bb: 1}, nil,
		},
	}

	serialized := gMsg.Marshal()

	parsed := protobuf_unittest.NewTestAllTypesReader()
	if err := parsed.Unmarshal(serialized); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}

	if len(parsed.GetRepeatedLazyMessage()) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(parsed.GetRepeatedLazyMessage()))
	}
	if parsed.GetRepeatedLazyMessage()[0] != nil {
		t.Errorf("Expected nil, got %v", parsed.GetRepeatedLazyMessage()[0])
	}
	if parsed.GetRepeatedLazyMessage()[1].GetBb() != 1 {
		t.Errorf("Expected 1, got %d", parsed.GetRepeatedLazyMessage()[1].GetBb())
	}
	if parsed.GetRepeatedLazyMessage()[2] != nil {
		t.Errorf("Expected nil, got %v", parsed.GetRepeatedLazyMessage()[2])
	}
}

func TestNilMap(t *testing.T) {
	gMsg := &map_test.TestMap{
		Int32ToMessageField: map[int32]*map_test.TestMap_MessageValue{
			0: nil,
			2: {Value: 2},
			3: nil,
		},
	}

	serialized := gMsg.Marshal()

	parsed := map_test.NewTestMapReader()
	if err := parsed.Unmarshal(serialized); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}

	if len(parsed.GetInt32ToMessageField()) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(parsed.GetInt32ToMessageField()))
	}
	if parsed.GetInt32ToMessageField()[0] != nil {
		t.Errorf("Expected nil, got %v", parsed.GetInt32ToMessageField()[1])
	}
	if parsed.GetInt32ToMessageField()[2].GetValue() != 2 {
		t.Errorf("Expected 2, got %d", parsed.GetInt32ToMessageField()[2].GetValue())
	}
	if parsed.GetInt32ToMessageField()[3] != nil {
		t.Errorf("Expected nil, got %v", parsed.GetInt32ToMessageField()[3])
	}
}

func TestNegativeValues(t *testing.T) {
	pb := &protobuf_unittest.TestAllTypes{
		OptionalInt32:    -100,
		OptionalInt64:    -101,
		OptionalSint32:   -102,
		OptionalSint64:   -103,
		OptionalSfixed32: -104,
		OptionalSfixed64: -105,
		OptionalFloat:    -105,
		OptionalDouble:   -106,
		RepeatedInt32:    []int32{-200, -300},
		RepeatedInt64:    []int64{-201, -301},
		RepeatedSint32:   []int32{-202, -302},
		RepeatedSint64:   []int64{-203, -303},
		RepeatedSfixed32: []int32{-204, -304},
		RepeatedSfixed64: []int64{-205, -305},
		RepeatedFloat:    []float32{-205, -305},
		RepeatedDouble:   []float64{-206, -306},
	}

	serialized := pb.Marshal()

	parsed := protobuf_unittest.NewTestAllTypesReader()
	if err := parsed.Unmarshal(serialized); err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}

	if parsed.GetOptionalInt32() != -100 {
		t.Errorf("Expected -100, got %d", parsed.GetOptionalInt32())
	}
	if parsed.GetOptionalInt64() != -101 {
		t.Errorf("Expected -101, got %d", parsed.GetOptionalInt64())
	}
	if parsed.GetOptionalSint32() != -102 {
		t.Errorf("Expected -102, got %d", parsed.GetOptionalSint32())
	}
	if parsed.GetOptionalSint64() != -103 {
		t.Errorf("Expected -103, got %d", parsed.GetOptionalSint64())
	}
	if parsed.GetOptionalSfixed32() != -104 {
		t.Errorf("Expected -104, got %d", parsed.GetOptionalSfixed32())
	}
	if parsed.GetOptionalSfixed64() != -105 {
		t.Errorf("Expected -105, got %d", parsed.GetOptionalSfixed64())
	}
	if parsed.GetOptionalFloat() != -105 {
		t.Errorf("Expected -105, got %f", parsed.GetOptionalFloat())
	}
	if parsed.GetOptionalDouble() != -106 {
		t.Errorf("Expected -106, got %f", parsed.GetOptionalDouble())
	}
	if len(parsed.GetRepeatedInt32()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedInt32()))
	}
	if parsed.GetRepeatedInt32()[0] != -200 {
		t.Errorf("Expected -200, got %d", parsed.GetRepeatedInt32()[0])
	}
	if parsed.GetRepeatedInt32()[1] != -300 {
		t.Errorf("Expected -300, got %d", parsed.GetRepeatedInt32()[1])
	}
	if len(parsed.GetRepeatedInt64()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedInt64()))
	}
	if parsed.GetRepeatedInt64()[0] != -201 {
		t.Errorf("Expected -201, got %d", parsed.GetRepeatedInt64()[0])
	}
	if parsed.GetRepeatedInt64()[1] != -301 {
		t.Errorf("Expected -301, got %d", parsed.GetRepeatedInt64()[1])
	}
	if len(parsed.GetRepeatedSint32()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedSint32()))
	}
	if parsed.GetRepeatedSint32()[0] != -202 {
		t.Errorf("Expected -202, got %d", parsed.GetRepeatedSint32()[0])
	}
	if parsed.GetRepeatedSint32()[1] != -302 {
		t.Errorf("Expected -302, got %d", parsed.GetRepeatedSint32()[1])
	}
	if len(parsed.GetRepeatedSint64()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedSint64()))
	}
	if parsed.GetRepeatedSint64()[0] != -203 {
		t.Errorf("Expected -203, got %d", parsed.GetRepeatedSint64()[0])
	}
	if parsed.GetRepeatedSint64()[1] != -303 {
		t.Errorf("Expected -303, got %d", parsed.GetRepeatedSint64()[1])
	}
	if len(parsed.GetRepeatedSfixed32()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedSfixed32()))
	}
	if parsed.GetRepeatedSfixed32()[0] != -204 {
		t.Errorf("Expected -204, got %d", parsed.GetRepeatedSfixed32()[0])
	}
	if parsed.GetRepeatedSfixed32()[1] != -304 {
		t.Errorf("Expected -304, got %d", parsed.GetRepeatedSfixed32()[1])
	}
	if len(parsed.GetRepeatedSfixed64()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedSfixed64()))
	}
	if parsed.GetRepeatedSfixed64()[0] != -205 {
		t.Errorf("Expected -205, got %d", parsed.GetRepeatedSfixed64()[0])
	}
	if parsed.GetRepeatedSfixed64()[1] != -305 {
		t.Errorf("Expected -305, got %d", parsed.GetRepeatedSfixed64()[1])
	}
	if len(parsed.GetRepeatedFloat()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedFloat()))
	}
	if parsed.GetRepeatedFloat()[0] != -205 {
		t.Errorf("Expected -205, got %f", parsed.GetRepeatedFloat()[0])
	}
	if parsed.GetRepeatedFloat()[1] != -305 {
		t.Errorf("Expected -305, got %f", parsed.GetRepeatedFloat()[1])
	}
	if len(parsed.GetRepeatedDouble()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(parsed.GetRepeatedDouble()))
	}
	if parsed.GetRepeatedDouble()[0] != -206 {
		t.Errorf("Expected -206, got %f", parsed.GetRepeatedDouble()[0])
	}
	if parsed.GetRepeatedDouble()[1] != -306 {
		t.Errorf("Expected -306, got %f", parsed.GetRepeatedDouble()[1])
	}
}

func TestChildMsg(t *testing.T) {
	msg := &protobuf_unittest.TestAllTypes{
		OptionalNestedMessage: &protobuf_unittest.TestAllTypes_NestedMessage{
			Bb: 118,
		},
	}

	content := msg.Marshal()

	parsed := protobuf_unittest.NewTestAllTypesReader()
	if err := parsed.Unmarshal(content); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}

	if parsed.GetOptionalNestedMessage().GetBb() != 118 {
		t.Errorf("Expected 118, got %d", parsed.GetOptionalNestedMessage().GetBb())
	}
}

func TestBasicRW2(t *testing.T) {
	msg := &protobuf_unittest.TestAllTypes_NestedMessage{
		Bb: 118,
	}

	content := msg.Marshal()

	parsed := protobuf_unittest.NewTestAllTypes_NestedMessageReader()
	if err := parsed.Unmarshal(content); err != nil {
		t.Errorf("Failed to parse: %v", err)
	}

	if parsed.GetBb() != msg.Bb {
		t.Fatalf("Expected %v, got %v", msg.Bb, parsed.GetBb())
	}
}

func TestBasicValues(t *testing.T) {
	msg := &test.NidOptNative{
		Field1:  1,
		Field2:  2,
		Field3:  3,
		Field4:  4,
		Field5:  5,
		Field6:  6,
		Field7:  7,
		Field8:  8,
		Field9:  9,
		Field10: 10,
		Field11: 11,
		Field12: 12,
		Field13: true,
		Field14: "13",
		Field15: []byte("14"),
	}
	data := msg.Marshal()
	size := msg.XXX_PbContentSize()
	if len(data) != size {
		t.Fatalf("Expected %v, got %v", size, len(data))
	}

	parsed := test.NewNidOptNativeReader()
	if err := parsed.Unmarshal(data); err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}
	if parsed.GetField1() != msg.Field1 {
		t.Fatalf("Expected %v, got %v", msg.Field1, parsed.GetField1())
	}
	if parsed.GetField2() != msg.Field2 {
		t.Fatalf("Expected %v, got %v", msg.Field2, parsed.GetField2())
	}
	if parsed.GetField3() != msg.Field3 {
		t.Fatalf("Expected %v, got %v", msg.Field3, parsed.GetField3())
	}
	if parsed.GetField4() != msg.Field4 {
		t.Fatalf("Expected %v, got %v", msg.Field4, parsed.GetField4())
	}
	if parsed.GetField5() != msg.Field5 {
		t.Fatalf("Expected %v, got %v", msg.Field5, parsed.GetField5())
	}
	if parsed.GetField6() != msg.Field6 {
		t.Fatalf("Expected %v, got %v", msg.Field6, parsed.GetField6())
	}
	if parsed.GetField7() != msg.Field7 {
		t.Fatalf("Expected %v, got %v", msg.Field7, parsed.GetField7())
	}
	if parsed.GetField8() != msg.Field8 {
		t.Fatalf("Expected %v, got %v", msg.Field8, parsed.GetField8())
	}
	if parsed.GetField9() != msg.Field9 {
		t.Fatalf("Expected %v, got %v", msg.Field9, parsed.GetField9())
	}
	if parsed.GetField10() != msg.Field10 {
		t.Fatalf("Expected %v, got %v", msg.Field10, parsed.GetField10())
	}
	if parsed.GetField11() != msg.Field11 {
		t.Fatalf("Expected %v, got %v", msg.Field11, parsed.GetField11())
	}
	if parsed.GetField12() != msg.Field12 {
		t.Fatalf("Expected %v, got %v", msg.Field12, parsed.GetField12())
	}
	if parsed.GetField13() != msg.Field13 {
		t.Fatalf("Expected %v, got %v", msg.Field13, parsed.GetField13())
	}
	if parsed.GetField14() != msg.Field14 {
		t.Fatalf("Expected %v, got %v", msg.Field14, parsed.GetField14())
	}
	if !bytes.Equal(parsed.GetField15(), msg.Field15) {
		t.Fatalf("Expected %v, got %v", msg.Field15, parsed.GetField15())
	}
}
