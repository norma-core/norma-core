package main

import (
	"flag"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/norma-core/norma-core/shared/gremlin_go/bench"
	google_benchmark "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/benchmark"
	google_unittest "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
	unittest_gremlin "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/protobuf_unittest"
	"google.golang.org/protobuf/proto"
)

type BenchResult struct {
	Name        string
	NsPerOp     int64
	BytesPerOp  int64
	AllocsPerOp int64
}

func formatWithUnderscores(n int) string {
	s := strconv.Itoa(n)
	if len(s) <= 3 {
		return s
	}

	var result strings.Builder
	for i, digit := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			result.WriteByte('_')
		}
		result.WriteRune(digit)
	}
	return result.String()
}

func getCPUInfo() string {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("sysctl", "-n", "machdep.cpu.brand_string")
	case "linux":
		cmd = exec.Command("sh", "-c", "cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d ':' -f2")
	case "freebsd":
		cmd = exec.Command("sysctl", "-n", "hw.model")
	default:
		return "Unknown"
	}

	output, err := cmd.Output()
	if err != nil {
		return "Unknown"
	}

	return strings.TrimSpace(string(output))
}

func runBenchmark(name string, iterations int, fn func()) BenchResult {
	// Warmup
	for i := 0; i < 100; i++ {
		fn()
	}

	runtime.GC()

	var memBefore, memAfter runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	start := time.Now()
	for i := 0; i < iterations; i++ {
		fn()
	}
	elapsed := time.Since(start)

	runtime.ReadMemStats(&memAfter)

	allocsPerOp := (memAfter.Mallocs - memBefore.Mallocs) / uint64(iterations)
	bytesPerOp := (memAfter.TotalAlloc - memBefore.TotalAlloc) / uint64(iterations)

	return BenchResult{
		Name:        name,
		NsPerOp:     elapsed.Nanoseconds() / int64(iterations),
		BytesPerOp:  int64(bytesPerOp),
		AllocsPerOp: int64(allocsPerOp),
	}
}

func main() {
	iterations := flag.Int("n", 200000, "number of iterations per benchmark")
	flag.Parse()

	fmt.Println("===========================================")
	fmt.Println("Gremlin vs Google Protobuf Benchmarks")
	fmt.Println("===========================================")
	fmt.Printf("Platform: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Printf("CPU: %s\n", getCPUInfo())
	fmt.Printf("CPU Cores: %d\n", runtime.NumCPU())
	fmt.Printf("Go Version: %s\n", runtime.Version())
	fmt.Printf("Iterations: %s\n", formatWithUnderscores(*iterations))
	fmt.Println("===========================================")
	fmt.Println()

	runDeepNestedBenchmarks(*iterations)
	fmt.Println()
	runGoldenMessageBenchmarks(*iterations)

	fmt.Println("===========================================")
	fmt.Println("✅ Benchmark Complete!")
	fmt.Println("===========================================")
}

func runDeepNestedBenchmarks(iterations int) {
	fmt.Println("🌳 DEEP NESTED MESSAGE BENCHMARKS")
	fmt.Println("-------------------------------------------")

	// Prepare data
	gremlinMsg := bench.CreateDeepNestedGremlin()
	googleMsg := bench.CreateDeepNestedGoogle()

	gremlinData := gremlinMsg.Marshal()
	googleData, _ := proto.Marshal(googleMsg)

	fmt.Println("📦 Message Size:")
	fmt.Printf("  Gremlin: %d bytes\n", len(gremlinData))
	fmt.Printf("  Google:  %d bytes\n\n", len(googleData))

	// Marshal benchmarks
	fmt.Println("🔨 Marshal (Serialize):")
	result := runBenchmark("Gremlin Marshal", iterations, func() {
		gremlinMsg.RootId = 1
		_ = gremlinMsg.Marshal()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Marshal", iterations, func() {
		googleMsg.RootId = 1
		_, _ = proto.Marshal(googleMsg)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Unmarshal benchmarks
	fmt.Println("📖 Unmarshal (Deserialize):")
	result = runBenchmark("Gremlin Unmarshal", iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Unmarshal", iterations, func() {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(googleData, reader)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Root-only access (lazy parsing benefit)
	fmt.Println("🎯 Unmarshal + Root Access (Lazy Parsing):")
	result = runBenchmark("Gremlin Root Only", iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Root Only", iterations, func() {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(googleData, reader)
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Full deep access
	fmt.Println("🔍 Full Deep Access (All Nested Fields):")
	result = runBenchmark("Gremlin Full Access", iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
		_ = reader.GetRootId()
		_ = reader.GetNested().GetId()
		_ = reader.GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetNested().GetValue()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Full Access", iterations, func() {
		reader := &google_benchmark.DeepNested{}
		_ = proto.Unmarshal(googleData, reader)
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
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)
}

func runGoldenMessageBenchmarks(iterations int) {
	fmt.Println("📜 GOLDEN MESSAGE BENCHMARKS (protobuf_unittest)")
	fmt.Println("-------------------------------------------")

	// Prepare data
	gremlinMsg := bench.CreateGoldenMessageGremlin()
	googleMsg := bench.CreateGoldenMessageGoogle()

	gremlinData := gremlinMsg.Marshal()
	googleData, _ := proto.Marshal(googleMsg)

	goldenData := bench.GetTestFileContent("golden_message")

	fmt.Println("📦 Message Size:")
	fmt.Printf("  Gremlin: %d bytes\n", len(gremlinData))
	fmt.Printf("  Google:  %d bytes\n", len(googleData))
	fmt.Printf("  Golden (binary test data): %d bytes\n\n", len(goldenData))

	// Marshal benchmarks
	fmt.Println("🔨 Marshal (Serialize):")
	result := runBenchmark("Gremlin Marshal", iterations, func() {
		bench.UpdateGoldenMessageGremlin(gremlinMsg, 1)
		_ = gremlinMsg.Marshal()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Marshal", iterations, func() {
		bench.UpdateGoldenMessageGoogle(googleMsg, 1)
		_, _ = proto.Marshal(googleMsg)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Unmarshal benchmarks
	fmt.Println("📖 Unmarshal (Deserialize):")
	result = runBenchmark("Gremlin Unmarshal", iterations, func() {
		reader := unittest_gremlin.NewTestAllTypesReader()
		_ = reader.Unmarshal(goldenData)
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Unmarshal", iterations, func() {
		reader := &google_unittest.TestAllTypes{}
		_ = proto.Unmarshal(goldenData, reader)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Root-only access
	fmt.Println("🎯 Unmarshal + Root Access (Lazy Parsing):")
	result = runBenchmark("Gremlin Root Only", iterations, func() {
		reader := unittest_gremlin.NewTestAllTypesReader()
		_ = reader.Unmarshal(goldenData)
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalInt64()
		_ = reader.GetOptionalString()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Root Only", iterations, func() {
		reader := &google_unittest.TestAllTypes{}
		_ = proto.Unmarshal(goldenData, reader)
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalInt64()
		_ = reader.GetOptionalString()
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Deep access
	fmt.Println("🔍 Deep Access (Including Nested Messages):")
	result = runBenchmark("Gremlin Deep Access", iterations, func() {
		reader := unittest_gremlin.NewTestAllTypesReader()
		_ = reader.Unmarshal(goldenData)
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalString()
		_ = reader.GetOptionalNestedMessage().GetBb()
		_ = reader.GetOptionalForeignMessage().GetC()
		_ = reader.GetRepeatedInt32()
		_ = reader.GetRepeatedString()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Deep Access", iterations, func() {
		reader := &google_unittest.TestAllTypes{}
		_ = proto.Unmarshal(goldenData, reader)
		_ = reader.GetOptionalInt32()
		_ = reader.GetOptionalString()
		if nested := reader.GetOptionalNestedMessage(); nested != nil {
			_ = nested.GetBb()
		}
		if foreign := reader.GetOptionalForeignMessage(); foreign != nil {
			_ = foreign.GetC()
		}
		_ = reader.GetRepeatedInt32()
		_ = reader.GetRepeatedString()
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)
}
