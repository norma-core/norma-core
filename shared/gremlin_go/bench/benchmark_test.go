package bench_test

import (
	"testing"

	"github.com/norma-core/norma-core/shared/gremlin_go/bench"
	google_benchmark "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/benchmark"
	google_unittest "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
	unittest_gremlin "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/protobuf_unittest"
	"google.golang.org/protobuf/proto"
)

// Benchmark: Marshal (Serialize) - Deep Nested Messages
func BenchmarkMarshal_Gremlin_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGremlin()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		// Modify deep nested values to prevent any caching
		msg.RootId = int32(i)
		msg.Nested.Id = int32(i + 10)
		msg.Nested.Nested.Id = int32(i + 20)
		msg.Nested.Nested.Nested.Id = int32(i + 30)
		msg.Nested.Nested.Nested.Nested.Value = int32(i + 40)
		_ = msg.Marshal()
	}
}

func BenchmarkMarshal_Google_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGoogle()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		// Modify deep nested values to prevent any caching
		msg.RootId = int32(i)
		msg.Nested.Id = int32(i + 10)
		msg.Nested.Nested.Id = int32(i + 20)
		msg.Nested.Nested.Nested.Id = int32(i + 30)
		msg.Nested.Nested.Nested.Nested.Value = int32(i + 40)
		_, _ = proto.Marshal(msg)
	}
}

// Benchmark: Unmarshal (Deserialize) - Deep Nested Messages
func BenchmarkUnmarshal_Gremlin_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGremlin()
	data := msg.Marshal()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(data)
	}
}

func BenchmarkUnmarshal_Google_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGoogle()
	data, _ := proto.Marshal(msg)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(data, reader)
	}
}

// Benchmark: Unmarshal + Access Root Fields Only (demonstrates lazy parsing)
func BenchmarkUnmarshal_Gremlin_DeepNested_RootOnly(b *testing.B) {
	msg := bench.CreateDeepNestedGremlin()
	data := msg.Marshal()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(data)
		// Only access root-level fields - nested messages are NOT parsed
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	}
}

func BenchmarkUnmarshal_Google_DeepNested_RootOnly(b *testing.B) {
	msg := bench.CreateDeepNestedGoogle()
	data, _ := proto.Marshal(msg)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(data, reader)
		// Access root-level fields - but nested messages are already parsed
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	}
}

// Benchmark: Full Message Access (parse everything)
func BenchmarkFullAccess_Gremlin_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGremlin()
	data := msg.Marshal()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(data)
		// Access all nested levels - null-safe chaining
		_ = reader.GetRootId()
		_ = reader.GetNested().GetId()
		_ = reader.GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetNested().GetValue()
	}
}

func BenchmarkFullAccess_Google_DeepNested(b *testing.B) {
	msg := bench.CreateDeepNestedGoogle()
	data, _ := proto.Marshal(msg)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(data, reader)
		// Access all nested levels - need nil checks
		_ = reader.GetRootId()
		if nested := reader.GetNested(); nested != nil {
			_ = nested.GetId()
			if nested2 := nested.GetNested(); nested2 != nil {
				_ = nested2.GetId()
				if nested3 := nested2.GetNested(); nested3 != nil {
					_ = nested3.GetId()
					if nested4 := nested3.GetNested(); nested4 != nil {
						_ = nested4.GetValue()
					}
				}
			}
		}
	}
}

// ============================================================================
// Golden Message Benchmarks (protobuf_unittest.TestAllTypes)
// ============================================================================

// Benchmark: Marshal (Serialize) Golden Message
func BenchmarkMarshal_Gremlin_GoldenMessage(b *testing.B) {
	msg := bench.CreateGoldenMessageGremlin()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		bench.UpdateGoldenMessageGremlin(msg, i)
		_ = msg.Marshal()
	}
}

// Benchmark: Unmarshal (Deserialize) Golden Message
func BenchmarkUnmarshal_Gremlin_GoldenMessage(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := unittest_gremlin.NewTestAllTypesReader()
		if err := reader.Unmarshal(content); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
	}
}

// Benchmark: Unmarshal + Access Root Fields Only (Lazy Parsing)
func BenchmarkUnmarshal_Gremlin_GoldenMessage_RootOnly(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := unittest_gremlin.NewTestAllTypesReader()
		if err := reader.Unmarshal(content); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Only access root-level scalar fields (lazy parsing benefit)
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalInt64()
		_ = reader.GetOptionalString()
	}
}

// Benchmark: Unmarshal + Deep Access All Fields (Full Parsing)
func BenchmarkUnmarshal_Gremlin_GoldenMessage_DeepAccess(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		reader := unittest_gremlin.NewTestAllTypesReader()
		if err := reader.Unmarshal(content); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Access all fields including nested messages
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalInt64()
		_ = reader.GetOptionalString()
		_ = reader.GetOptionalBytes()
		_ = reader.GetOptionalNestedMessage().GetBb()
		_ = reader.GetOptionalForeignMessage().GetC()
		_ = reader.GetOptionalImportMessage().GetD()
		_ = reader.GetRepeatedInt32()
		_ = reader.GetRepeatedString()
		_ = reader.GetRepeatedNestedMessage()
	}
}

// Benchmark: Round-trip (Marshal + Unmarshal)
func BenchmarkRoundTrip_Gremlin_GoldenMessage(b *testing.B) {
	msg := bench.CreateGoldenMessageGremlin()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		bench.UpdateGoldenMessageGremlin(msg, i)
		data := msg.Marshal()

		reader := unittest_gremlin.NewTestAllTypesReader()
		if err := reader.Unmarshal(data); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Access key fields
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalString()
		_ = reader.GetOptionalNestedMessage().GetBb()
	}
}

// ============================================================================
// Golden Message Benchmarks - Google Protobuf (for comparison)
// ============================================================================

// Benchmark: Marshal (Serialize) Golden Message - Google
func BenchmarkMarshal_Google_GoldenMessage(b *testing.B) {
	msg := bench.CreateGoldenMessageGoogle()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		bench.UpdateGoldenMessageGoogle(msg, i)
		_, _ = proto.Marshal(msg)
	}
}

// Benchmark: Unmarshal (Deserialize) Golden Message - Google
func BenchmarkUnmarshal_Google_GoldenMessage(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		msg := &google_unittest.TestAllTypes{}
		if err := proto.Unmarshal(content, msg); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
	}
}

// Benchmark: Unmarshal + Access Root Fields Only - Google
func BenchmarkUnmarshal_Google_GoldenMessage_RootOnly(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		msg := &google_unittest.TestAllTypes{}
		if err := proto.Unmarshal(content, msg); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Access root-level fields - but nested messages are already parsed
		_ = msg.GetOptionalInt32()
		_ = msg.GetOptionalInt64()
		_ = msg.GetOptionalString()
	}
}

// Benchmark: Unmarshal + Deep Access All Fields - Google
func BenchmarkUnmarshal_Google_GoldenMessage_DeepAccess(b *testing.B) {
	content := bench.GetTestFileContent("golden_message")
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		msg := &google_unittest.TestAllTypes{}
		if err := proto.Unmarshal(content, msg); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Access all fields - need nil checks
		_ = msg.GetOptionalInt32()
		_ = msg.GetOptionalInt64()
		_ = msg.GetOptionalString()
		_ = msg.GetOptionalBytes()
		if nested := msg.GetOptionalNestedMessage(); nested != nil {
			_ = nested.GetBb()
		}
		if foreign := msg.GetOptionalForeignMessage(); foreign != nil {
			_ = foreign.GetC()
		}
		if imported := msg.GetOptionalImportMessage(); imported != nil {
			_ = imported.GetD()
		}
		_ = msg.GetRepeatedInt32()
		_ = msg.GetRepeatedString()
		_ = msg.GetRepeatedNestedMessage()
	}
}

// Benchmark: Round-trip (Marshal + Unmarshal) - Google
func BenchmarkRoundTrip_Google_GoldenMessage(b *testing.B) {
	msg := bench.CreateGoldenMessageGoogle()
	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		bench.UpdateGoldenMessageGoogle(msg, i)
		data, _ := proto.Marshal(msg)

		newMsg := &google_unittest.TestAllTypes{}
		if err := proto.Unmarshal(data, newMsg); err != nil {
			b.Fatalf("failed to unmarshal: %v", err)
		}
		// Access key fields
		_ = newMsg.GetOptionalInt32()
		_ = newMsg.GetOptionalString()
		if nested := newMsg.GetOptionalNestedMessage(); nested != nil {
			_ = nested.GetBb()
		}
	}
}
