package bench

import (
	google_benchmark "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/benchmark"
	google_unittest "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
	unittest_gremlin "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/protobuf_unittest"
	unittest_import_gremlin "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/protobuf_unittest_import"
	"github.com/norma-core/norma-core/shared/gremlin_go/bench/testdata"
	"google.golang.org/protobuf/proto"
)

func CreateDeepNestedGremlin() *gremlin_pb.DeepNested {
	return &gremlin_pb.DeepNested{
		RootId:   1,
		RootName: "root_node_with_complex_nested_structure",
		Active:   true,
		Tags:     []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"},
		Nested: &gremlin_pb.Level1{
			Id:    10,
			Title: "level1_primary_branch",
			Score: 1.23456789,
			Nested: &gremlin_pb.Level2{
				Id:          20,
				Description: "level2_deeply_nested_with_payload",
				Payload:     []byte("this is a much longer payload with more realistic data content that would be found in production systems"),
				Nested: &gremlin_pb.Level3{
					Id:   30,
					Name: "level3_inner_structure",
					Nested: &gremlin_pb.Level4{
						Value:   40,
						Data:    "level4_leaf_node_with_data",
						Numbers: []int32{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
					},
					Items: []*gremlin_pb.Level4{
						{Value: 41, Data: "item1_with_numbers", Numbers: []int32{10, 20, 30, 40, 50}},
						{Value: 42, Data: "item2_with_numbers", Numbers: []int32{60, 70, 80, 90, 100}},
						{Value: 43, Data: "item3_with_numbers", Numbers: []int32{110, 120, 130, 140, 150}},
						{Value: 44, Data: "item4_with_numbers", Numbers: []int32{160, 170, 180, 190, 200}},
						{Value: 45, Data: "item5_with_numbers", Numbers: []int32{210, 220, 230, 240, 250}},
					},
				},
				Items: []*gremlin_pb.Level3{
					{
						Id:   31,
						Name: "item1_nested",
						Nested: &gremlin_pb.Level4{
							Value:   310,
							Data:    "nested_item1_data",
							Numbers: []int32{1, 2, 3, 4, 5},
						},
						Items: []*gremlin_pb.Level4{
							{Value: 311, Data: "sub1", Numbers: []int32{1, 2}},
							{Value: 312, Data: "sub2", Numbers: []int32{3, 4}},
						},
					},
					{
						Id:   32,
						Name: "item2_nested",
						Nested: &gremlin_pb.Level4{
							Value:   320,
							Data:    "nested_item2_data",
							Numbers: []int32{6, 7, 8, 9, 10},
						},
						Items: []*gremlin_pb.Level4{
							{Value: 321, Data: "sub3", Numbers: []int32{5, 6}},
							{Value: 322, Data: "sub4", Numbers: []int32{7, 8}},
						},
					},
					{
						Id:   33,
						Name: "item3_nested",
						Nested: &gremlin_pb.Level4{
							Value:   330,
							Data:    "nested_item3_data",
							Numbers: []int32{11, 12, 13, 14, 15},
						},
					},
					{
						Id:   34,
						Name: "item4_nested",
						Nested: &gremlin_pb.Level4{
							Value:   340,
							Data:    "nested_item4_data",
							Numbers: []int32{16, 17, 18, 19, 20},
						},
					},
				},
			},
			Items: []*gremlin_pb.Level2{
				{
					Id:          21,
					Description: "item1_level2_with_payload",
					Payload:     []byte("payload for item 1"),
					Nested: &gremlin_pb.Level3{
						Id:   210,
						Name: "nested_in_item1",
						Nested: &gremlin_pb.Level4{
							Value:   2100,
							Data:    "deep_nested",
							Numbers: []int32{100, 200, 300},
						},
					},
				},
				{
					Id:          22,
					Description: "item2_level2_with_payload",
					Payload:     []byte("payload for item 2 with more data"),
					Nested: &gremlin_pb.Level3{
						Id:   220,
						Name: "nested_in_item2",
					},
				},
				{
					Id:          23,
					Description: "item3_level2_with_payload",
					Payload:     []byte("payload for item 3"),
				},
				{
					Id:          24,
					Description: "item4_level2_with_payload",
					Payload:     []byte("payload for item 4 with additional content"),
				},
			},
		},
		Items: []*gremlin_pb.Level1{
			{
				Id:    11,
				Title: "item1_top_level",
				Score: 2.34,
				Nested: &gremlin_pb.Level2{
					Id:          110,
					Description: "nested_in_top_item1",
					Payload:     []byte("some payload data"),
					Nested: &gremlin_pb.Level3{
						Id:   1100,
						Name: "deeply_nested_top_item1",
					},
				},
			},
			{
				Id:    12,
				Title: "item2_top_level",
				Score: 3.45,
				Nested: &gremlin_pb.Level2{
					Id:          120,
					Description: "nested_in_top_item2",
					Payload:     []byte("more payload data here"),
				},
			},
			{
				Id:    13,
				Title: "item3_top_level",
				Score: 4.56,
			},
			{
				Id:    14,
				Title: "item4_top_level",
				Score: 5.67,
				Nested: &gremlin_pb.Level2{
					Id:          140,
					Description: "nested_in_top_item4",
					Payload:     []byte("final payload data"),
				},
			},
			{
				Id:    15,
				Title: "item5_top_level",
				Score: 6.78,
			},
		},
	}
}

func CreateDeepNestedGoogle() *google_benchmark.DeepNested {
	return &google_benchmark.DeepNested{
		RootId:   1,
		RootName: "root_node_with_complex_nested_structure",
		Active:   true,
		Tags:     []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"},
		Nested: &google_benchmark.Level1{
			Id:    10,
			Title: "level1_primary_branch",
			Score: 1.23456789,
			Nested: &google_benchmark.Level2{
				Id:          20,
				Description: "level2_deeply_nested_with_payload",
				Payload:     []byte("this is a much longer payload with more realistic data content that would be found in production systems"),
				Nested: &google_benchmark.Level3{
					Id:   30,
					Name: "level3_inner_structure",
					Nested: &google_benchmark.Level4{
						Value:   40,
						Data:    "level4_leaf_node_with_data",
						Numbers: []int32{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
					},
					Items: []*google_benchmark.Level4{
						{Value: 41, Data: "item1_with_numbers", Numbers: []int32{10, 20, 30, 40, 50}},
						{Value: 42, Data: "item2_with_numbers", Numbers: []int32{60, 70, 80, 90, 100}},
						{Value: 43, Data: "item3_with_numbers", Numbers: []int32{110, 120, 130, 140, 150}},
						{Value: 44, Data: "item4_with_numbers", Numbers: []int32{160, 170, 180, 190, 200}},
						{Value: 45, Data: "item5_with_numbers", Numbers: []int32{210, 220, 230, 240, 250}},
					},
				},
				Items: []*google_benchmark.Level3{
					{
						Id:   31,
						Name: "item1_nested",
						Nested: &google_benchmark.Level4{
							Value:   310,
							Data:    "nested_item1_data",
							Numbers: []int32{1, 2, 3, 4, 5},
						},
						Items: []*google_benchmark.Level4{
							{Value: 311, Data: "sub1", Numbers: []int32{1, 2}},
							{Value: 312, Data: "sub2", Numbers: []int32{3, 4}},
						},
					},
					{
						Id:   32,
						Name: "item2_nested",
						Nested: &google_benchmark.Level4{
							Value:   320,
							Data:    "nested_item2_data",
							Numbers: []int32{6, 7, 8, 9, 10},
						},
						Items: []*google_benchmark.Level4{
							{Value: 321, Data: "sub3", Numbers: []int32{5, 6}},
							{Value: 322, Data: "sub4", Numbers: []int32{7, 8}},
						},
					},
					{
						Id:   33,
						Name: "item3_nested",
						Nested: &google_benchmark.Level4{
							Value:   330,
							Data:    "nested_item3_data",
							Numbers: []int32{11, 12, 13, 14, 15},
						},
					},
					{
						Id:   34,
						Name: "item4_nested",
						Nested: &google_benchmark.Level4{
							Value:   340,
							Data:    "nested_item4_data",
							Numbers: []int32{16, 17, 18, 19, 20},
						},
					},
				},
			},
			Items: []*google_benchmark.Level2{
				{
					Id:          21,
					Description: "item1_level2_with_payload",
					Payload:     []byte("payload for item 1"),
					Nested: &google_benchmark.Level3{
						Id:   210,
						Name: "nested_in_item1",
						Nested: &google_benchmark.Level4{
							Value:   2100,
							Data:    "deep_nested",
							Numbers: []int32{100, 200, 300},
						},
					},
				},
				{
					Id:          22,
					Description: "item2_level2_with_payload",
					Payload:     []byte("payload for item 2 with more data"),
					Nested: &google_benchmark.Level3{
						Id:   220,
						Name: "nested_in_item2",
					},
				},
				{
					Id:          23,
					Description: "item3_level2_with_payload",
					Payload:     []byte("payload for item 3"),
				},
				{
					Id:          24,
					Description: "item4_level2_with_payload",
					Payload:     []byte("payload for item 4 with additional content"),
				},
			},
		},
		Items: []*google_benchmark.Level1{
			{
				Id:    11,
				Title: "item1_top_level",
				Score: 2.34,
				Nested: &google_benchmark.Level2{
					Id:          110,
					Description: "nested_in_top_item1",
					Payload:     []byte("some payload data"),
					Nested: &google_benchmark.Level3{
						Id:   1100,
						Name: "deeply_nested_top_item1",
					},
				},
			},
			{
				Id:    12,
				Title: "item2_top_level",
				Score: 3.45,
				Nested: &google_benchmark.Level2{
					Id:          120,
					Description: "nested_in_top_item2",
					Payload:     []byte("more payload data here"),
				},
			},
			{
				Id:    13,
				Title: "item3_top_level",
				Score: 4.56,
			},
			{
				Id:    14,
				Title: "item4_top_level",
				Score: 5.67,
				Nested: &google_benchmark.Level2{
					Id:          140,
					Description: "nested_in_top_item4",
					Payload:     []byte("final payload data"),
				},
			},
			{
				Id:    15,
				Title: "item5_top_level",
				Score: 6.78,
			},
		},
	}
}

// GetTestFileContent reads embedded test data files
func GetTestFileContent(name string) []byte {
	content, err := testdata.TestData.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return content
}

// CreateGoldenMessageGremlin creates a TestAllTypes message with known golden values
func CreateGoldenMessageGremlin() *unittest_gremlin.TestAllTypes {
	msg := &unittest_gremlin.TestAllTypes{}
	PopulateGoldenMessageGremlin(msg)
	return msg
}

// PopulateGoldenMessageGremlin fills a TestAllTypes message with known test values
func PopulateGoldenMessageGremlin(msg *unittest_gremlin.TestAllTypes) {
	msg.OptionalInt32 = 101
	msg.OptionalInt64 = 102
	msg.OptionalUint32 = 103
	msg.OptionalUint64 = 104
	msg.OptionalSint32 = 105
	msg.OptionalSint64 = 106
	msg.OptionalFixed32 = 107
	msg.OptionalFixed64 = 108
	msg.OptionalSfixed32 = 109
	msg.OptionalSfixed64 = 110
	msg.OptionalFloat = 111.0
	msg.OptionalDouble = 112.0
	msg.OptionalBool = true
	msg.OptionalString = "115"
	msg.OptionalBytes = []byte("116")

	msg.OptionalNestedMessage = &unittest_gremlin.TestAllTypes_NestedMessage{
		Bb: 118,
	}
	msg.OptionalForeignMessage = &unittest_gremlin.ForeignMessage{
		C: 119,
	}
	msg.OptionalImportMessage = &unittest_import_gremlin.ImportMessage{
		D: 120,
	}
	msg.OptionalNestedEnum = unittest_gremlin.TestAllTypes_BAZ
	msg.OptionalForeignEnum = unittest_gremlin.ForeignEnum_FOREIGN_BAZ
	msg.OptionalImportEnum = unittest_import_gremlin.ImportEnum_IMPORT_BAZ
	msg.OptionalStringPiece = "124"
	msg.OptionalCord = "125"
	msg.OptionalPublicImportMessage = &unittest_import_gremlin.PublicImportMessage{
		E: 126,
	}
	msg.OptionalLazyMessage = &unittest_gremlin.TestAllTypes_NestedMessage{
		Bb: 127,
	}
	msg.OptionalUnverifiedLazyMessage = &unittest_gremlin.TestAllTypes_NestedMessage{
		Bb: 128,
	}
	msg.RepeatedInt32 = []int32{201, 301}
	msg.RepeatedInt64 = []int64{202, 302}
	msg.RepeatedUint32 = []uint32{203, 303}
	msg.RepeatedUint64 = []uint64{204, 304}
	msg.RepeatedSint32 = []int32{205, 305}
	msg.RepeatedSint64 = []int64{206, 306}
	msg.RepeatedFixed32 = []uint32{207, 307}
	msg.RepeatedFixed64 = []uint64{208, 308}
	msg.RepeatedSfixed32 = []int32{209, 309}
	msg.RepeatedSfixed64 = []int64{210, 310}
	msg.RepeatedFloat = []float32{211.0, 311.0}
	msg.RepeatedDouble = []float64{212.0, 312.0}
	msg.RepeatedBool = []bool{true, false}
	msg.RepeatedString = []string{"215", "315"}
	msg.RepeatedBytes = [][]byte{[]byte("216"), []byte("316")}
	msg.RepeatedNestedMessage = []*unittest_gremlin.TestAllTypes_NestedMessage{
		{Bb: 218},
		{Bb: 318},
	}
	msg.RepeatedForeignMessage = []*unittest_gremlin.ForeignMessage{
		{C: 219},
		{C: 319},
	}
	msg.RepeatedImportMessage = []*unittest_import_gremlin.ImportMessage{
		{D: 220},
		{D: 320},
	}
	msg.RepeatedNestedEnum = []unittest_gremlin.TestAllTypes_NestedEnum{
		unittest_gremlin.TestAllTypes_BAR,
		unittest_gremlin.TestAllTypes_BAZ,
	}
	msg.RepeatedForeignEnum = []unittest_gremlin.ForeignEnum{
		unittest_gremlin.ForeignEnum_FOREIGN_BAR,
		unittest_gremlin.ForeignEnum_FOREIGN_BAZ,
	}
	msg.RepeatedImportEnum = []unittest_import_gremlin.ImportEnum{
		unittest_import_gremlin.ImportEnum_IMPORT_BAR,
		unittest_import_gremlin.ImportEnum_IMPORT_BAZ,
	}
	msg.RepeatedStringPiece = []string{"224", "324"}
	msg.RepeatedCord = []string{"225", "325"}
	msg.RepeatedLazyMessage = []*unittest_gremlin.TestAllTypes_NestedMessage{
		{Bb: 227},
		{Bb: 327},
	}
	msg.DefaultInt32 = 401
	msg.DefaultInt64 = 402
	msg.DefaultUint32 = 403
	msg.DefaultUint64 = 404
	msg.DefaultSint32 = 405
	msg.DefaultSint64 = 406
	msg.DefaultFixed32 = 407
	msg.DefaultFixed64 = 408
	msg.DefaultSfixed32 = 409
	msg.DefaultSfixed64 = 410
	msg.DefaultFloat = 411.0
	msg.DefaultDouble = 412.0
	msg.DefaultBool = false
	msg.DefaultString = "415"
	msg.DefaultBytes = []byte("416")
	msg.DefaultNestedEnum = unittest_gremlin.TestAllTypes_FOO
	msg.DefaultForeignEnum = unittest_gremlin.ForeignEnum_FOREIGN_FOO
	msg.DefaultImportEnum = unittest_import_gremlin.ImportEnum_IMPORT_FOO
	msg.DefaultStringPiece = "424"
	msg.DefaultCord = "425"
	msg.OneofUint32 = 601
}

// UpdateGoldenMessageGremlin modifies fields for benchmarking to prevent caching
func UpdateGoldenMessageGremlin(msg *unittest_gremlin.TestAllTypes, i int) {
	msg.OptionalInt32 = 101 + int32(i)
	msg.OptionalNestedMessage.Bb = 118 + int32(i)
	msg.RepeatedNestedMessage[0].Bb = 218 + int32(i)
	msg.RepeatedNestedMessage[1].Bb = 318 + int32(i)
	msg.OneofUint32 = 601 + uint32(i)
}

// CreateGoldenMessageGoogle creates a Google protobuf TestAllTypes message with known golden values
func CreateGoldenMessageGoogle() *google_unittest.TestAllTypes {
	msg := &google_unittest.TestAllTypes{}
	PopulateGoldenMessageGoogle(msg)
	return msg
}

// PopulateGoldenMessageGoogle fills a Google protobuf TestAllTypes message with known test values
func PopulateGoldenMessageGoogle(msg *google_unittest.TestAllTypes) {
	msg.OptionalInt32 = proto.Int32(101)
	msg.OptionalInt64 = proto.Int64(102)
	msg.OptionalUint32 = proto.Uint32(103)
	msg.OptionalUint64 = proto.Uint64(104)
	msg.OptionalSint32 = proto.Int32(105)
	msg.OptionalSint64 = proto.Int64(106)
	msg.OptionalFixed32 = proto.Uint32(107)
	msg.OptionalFixed64 = proto.Uint64(108)
	msg.OptionalSfixed32 = proto.Int32(109)
	msg.OptionalSfixed64 = proto.Int64(110)
	msg.OptionalFloat = proto.Float32(111.0)
	msg.OptionalDouble = proto.Float64(112.0)
	msg.OptionalBool = proto.Bool(true)
	msg.OptionalString = proto.String("115")
	msg.OptionalBytes = []byte("116")

	msg.OptionalNestedMessage = &google_unittest.TestAllTypes_NestedMessage{
		Bb: proto.Int32(118),
	}
	msg.OptionalForeignMessage = &google_unittest.ForeignMessage{
		C: proto.Int32(119),
	}
	msg.OptionalImportMessage = &google_unittest.ImportMessage{
		D: proto.Int32(120),
	}
	msg.OptionalNestedEnum = google_unittest.TestAllTypes_BAZ.Enum()
	msg.OptionalForeignEnum = google_unittest.ForeignEnum_FOREIGN_BAZ.Enum()
	msg.OptionalImportEnum = google_unittest.ImportEnum_IMPORT_BAZ.Enum()
	msg.OptionalStringPiece = proto.String("124")
	msg.OptionalCord = proto.String("125")
	msg.OptionalPublicImportMessage = &google_unittest.PublicImportMessage{
		E: proto.Int32(126),
	}
	msg.OptionalLazyMessage = &google_unittest.TestAllTypes_NestedMessage{
		Bb: proto.Int32(127),
	}
	msg.OptionalUnverifiedLazyMessage = &google_unittest.TestAllTypes_NestedMessage{
		Bb: proto.Int32(128),
	}
	msg.RepeatedInt32 = []int32{201, 301}
	msg.RepeatedInt64 = []int64{202, 302}
	msg.RepeatedUint32 = []uint32{203, 303}
	msg.RepeatedUint64 = []uint64{204, 304}
	msg.RepeatedSint32 = []int32{205, 305}
	msg.RepeatedSint64 = []int64{206, 306}
	msg.RepeatedFixed32 = []uint32{207, 307}
	msg.RepeatedFixed64 = []uint64{208, 308}
	msg.RepeatedSfixed32 = []int32{209, 309}
	msg.RepeatedSfixed64 = []int64{210, 310}
	msg.RepeatedFloat = []float32{211.0, 311.0}
	msg.RepeatedDouble = []float64{212.0, 312.0}
	msg.RepeatedBool = []bool{true, false}
	msg.RepeatedString = []string{"215", "315"}
	msg.RepeatedBytes = [][]byte{[]byte("216"), []byte("316")}
	msg.RepeatedNestedMessage = []*google_unittest.TestAllTypes_NestedMessage{
		{Bb: proto.Int32(218)},
		{Bb: proto.Int32(318)},
	}
	msg.RepeatedForeignMessage = []*google_unittest.ForeignMessage{
		{C: proto.Int32(219)},
		{C: proto.Int32(319)},
	}
	msg.RepeatedImportMessage = []*google_unittest.ImportMessage{
		{D: proto.Int32(220)},
		{D: proto.Int32(320)},
	}
	msg.RepeatedNestedEnum = []google_unittest.TestAllTypes_NestedEnum{
		google_unittest.TestAllTypes_BAR,
		google_unittest.TestAllTypes_BAZ,
	}
	msg.RepeatedForeignEnum = []google_unittest.ForeignEnum{
		google_unittest.ForeignEnum_FOREIGN_BAR,
		google_unittest.ForeignEnum_FOREIGN_BAZ,
	}
	msg.RepeatedImportEnum = []google_unittest.ImportEnum{
		google_unittest.ImportEnum_IMPORT_BAR,
		google_unittest.ImportEnum_IMPORT_BAZ,
	}
	msg.RepeatedStringPiece = []string{"224", "324"}
	msg.RepeatedCord = []string{"225", "325"}
	msg.RepeatedLazyMessage = []*google_unittest.TestAllTypes_NestedMessage{
		{Bb: proto.Int32(227)},
		{Bb: proto.Int32(327)},
	}
	msg.DefaultInt32 = proto.Int32(401)
	msg.DefaultInt64 = proto.Int64(402)
	msg.DefaultUint32 = proto.Uint32(403)
	msg.DefaultUint64 = proto.Uint64(404)
	msg.DefaultSint32 = proto.Int32(405)
	msg.DefaultSint64 = proto.Int64(406)
	msg.DefaultFixed32 = proto.Uint32(407)
	msg.DefaultFixed64 = proto.Uint64(408)
	msg.DefaultSfixed32 = proto.Int32(409)
	msg.DefaultSfixed64 = proto.Int64(410)
	msg.DefaultFloat = proto.Float32(411.0)
	msg.DefaultDouble = proto.Float64(412.0)
	msg.DefaultBool = proto.Bool(false)
	msg.DefaultString = proto.String("415")
	msg.DefaultBytes = []byte("416")
	msg.DefaultNestedEnum = google_unittest.TestAllTypes_FOO.Enum()
	msg.DefaultForeignEnum = google_unittest.ForeignEnum_FOREIGN_FOO.Enum()
	msg.DefaultImportEnum = google_unittest.ImportEnum_IMPORT_FOO.Enum()
	msg.DefaultStringPiece = proto.String("424")
	msg.DefaultCord = proto.String("425")
	msg.OneofField = &google_unittest.TestAllTypes_OneofUint32{OneofUint32: 601}
}

// UpdateGoldenMessageGoogle modifies fields for benchmarking to prevent caching
func UpdateGoldenMessageGoogle(msg *google_unittest.TestAllTypes, i int) {
	msg.OptionalInt32 = proto.Int32(101 + int32(i))
	msg.OptionalNestedMessage.Bb = proto.Int32(118 + int32(i))
	msg.RepeatedNestedMessage[0].Bb = proto.Int32(218 + int32(i))
	msg.RepeatedNestedMessage[1].Bb = proto.Int32(318 + int32(i))
	msg.OneofField = &google_unittest.TestAllTypes_OneofUint32{OneofUint32: 601 + uint32(i)}
}
