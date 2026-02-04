package bench

import (
	google_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/protobufs"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
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

func CreateDeepNestedGoogle() *google_pb.DeepNested {
	return &google_pb.DeepNested{
		RootId:   1,
		RootName: "root_node_with_complex_nested_structure",
		Active:   true,
		Tags:     []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"},
		Nested: &google_pb.Level1{
			Id:    10,
			Title: "level1_primary_branch",
			Score: 1.23456789,
			Nested: &google_pb.Level2{
				Id:          20,
				Description: "level2_deeply_nested_with_payload",
				Payload:     []byte("this is a much longer payload with more realistic data content that would be found in production systems"),
				Nested: &google_pb.Level3{
					Id:   30,
					Name: "level3_inner_structure",
					Nested: &google_pb.Level4{
						Value:   40,
						Data:    "level4_leaf_node_with_data",
						Numbers: []int32{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15},
					},
					Items: []*google_pb.Level4{
						{Value: 41, Data: "item1_with_numbers", Numbers: []int32{10, 20, 30, 40, 50}},
						{Value: 42, Data: "item2_with_numbers", Numbers: []int32{60, 70, 80, 90, 100}},
						{Value: 43, Data: "item3_with_numbers", Numbers: []int32{110, 120, 130, 140, 150}},
						{Value: 44, Data: "item4_with_numbers", Numbers: []int32{160, 170, 180, 190, 200}},
						{Value: 45, Data: "item5_with_numbers", Numbers: []int32{210, 220, 230, 240, 250}},
					},
				},
				Items: []*google_pb.Level3{
					{
						Id:   31,
						Name: "item1_nested",
						Nested: &google_pb.Level4{
							Value:   310,
							Data:    "nested_item1_data",
							Numbers: []int32{1, 2, 3, 4, 5},
						},
						Items: []*google_pb.Level4{
							{Value: 311, Data: "sub1", Numbers: []int32{1, 2}},
							{Value: 312, Data: "sub2", Numbers: []int32{3, 4}},
						},
					},
					{
						Id:   32,
						Name: "item2_nested",
						Nested: &google_pb.Level4{
							Value:   320,
							Data:    "nested_item2_data",
							Numbers: []int32{6, 7, 8, 9, 10},
						},
						Items: []*google_pb.Level4{
							{Value: 321, Data: "sub3", Numbers: []int32{5, 6}},
							{Value: 322, Data: "sub4", Numbers: []int32{7, 8}},
						},
					},
					{
						Id:   33,
						Name: "item3_nested",
						Nested: &google_pb.Level4{
							Value:   330,
							Data:    "nested_item3_data",
							Numbers: []int32{11, 12, 13, 14, 15},
						},
					},
					{
						Id:   34,
						Name: "item4_nested",
						Nested: &google_pb.Level4{
							Value:   340,
							Data:    "nested_item4_data",
							Numbers: []int32{16, 17, 18, 19, 20},
						},
					},
				},
			},
			Items: []*google_pb.Level2{
				{
					Id:          21,
					Description: "item1_level2_with_payload",
					Payload:     []byte("payload for item 1"),
					Nested: &google_pb.Level3{
						Id:   210,
						Name: "nested_in_item1",
						Nested: &google_pb.Level4{
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
					Nested: &google_pb.Level3{
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
		Items: []*google_pb.Level1{
			{
				Id:    11,
				Title: "item1_top_level",
				Score: 2.34,
				Nested: &google_pb.Level2{
					Id:          110,
					Description: "nested_in_top_item1",
					Payload:     []byte("some payload data"),
					Nested: &google_pb.Level3{
						Id:   1100,
						Name: "deeply_nested_top_item1",
					},
				},
			},
			{
				Id:    12,
				Title: "item2_top_level",
				Score: 3.45,
				Nested: &google_pb.Level2{
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
				Nested: &google_pb.Level2{
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
