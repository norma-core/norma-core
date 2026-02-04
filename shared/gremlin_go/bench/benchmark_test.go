package bench_test

import (
	"testing"

	"github.com/norma-core/norma-core/shared/gremlin_go/bench"
	google_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/protobufs"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
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
		reader := &google_pb.DeepNested{}
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
		reader := &google_pb.DeepNested{}
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
		reader := &google_pb.DeepNested{}
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
