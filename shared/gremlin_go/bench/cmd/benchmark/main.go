package main

import (
	"flag"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/norma-core/norma-core/shared/gremlin_go/bench"
	google_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/protobufs"
	gremlin_pb "github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb/benchmark"
	"google.golang.org/protobuf/proto"
)

type BenchResult struct {
	Name        string
	NsPerOp     int64
	BytesPerOp  int64
	AllocsPerOp int64
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
	iterations := flag.Int("n", 10000000, "number of iterations per benchmark")
	flag.Parse()

	fmt.Println("===========================================")
	fmt.Println("Gremlin vs Google Protobuf Benchmarks")
	fmt.Println("===========================================")
	fmt.Printf("Platform: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Printf("CPU: %s\n", getCPUInfo())
	fmt.Printf("CPU Cores: %d\n", runtime.NumCPU())
	fmt.Printf("Go Version: %s\n", runtime.Version())
	fmt.Printf("Iterations: %d\n", *iterations)
	fmt.Println("===========================================")
	fmt.Println()

	// Prepare data
	gremlinMsg := bench.CreateDeepNestedGremlin()
	googleMsg := bench.CreateDeepNestedGoogle()

	gremlinData := gremlinMsg.Marshal()
	googleData, _ := proto.Marshal(googleMsg)

	fmt.Println("📦 Message Size:")
	fmt.Printf("  Gremlin: %d bytes\n", len(gremlinData))
	fmt.Printf("  Google:  %d bytes\n\n", len(googleData))

	// Marshal benchmarks
	fmt.Println("🔨 Marshal (Serialize) Benchmarks:")
	result := runBenchmark("Gremlin Marshal", *iterations, func() {
		gremlinMsg.RootId = 1
		_ = gremlinMsg.Marshal()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Marshal", *iterations, func() {
		googleMsg.RootId = 1
		_, _ = proto.Marshal(googleMsg)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Unmarshal benchmarks
	fmt.Println("📖 Unmarshal (Deserialize) Benchmarks:")
	result = runBenchmark("Gremlin Unmarshal", *iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Unmarshal", *iterations, func() {
		reader := &google_pb.DeepNested{}
		_ = proto.Unmarshal(googleData, reader)
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Root-only access (lazy parsing benefit)
	fmt.Println("🎯 Unmarshal + Root Access (Lazy Parsing):")
	result = runBenchmark("Gremlin Root Only", *iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Root Only", *iterations, func() {
		reader := &google_pb.DeepNested{}
		_ = proto.Unmarshal(googleData, reader)
		_ = reader.GetRootId()
		_ = reader.GetRootName()
		_ = reader.GetActive()
	})
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	// Full deep access
	fmt.Println("🔍 Full Deep Access (All Nested Fields):")
	result = runBenchmark("Gremlin Full Access", *iterations, func() {
		reader := gremlin_pb.NewDeepNestedReader()
		_ = reader.Unmarshal(gremlinData)
		_ = reader.GetRootId()
		_ = reader.GetNested().GetId()
		_ = reader.GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetId()
		_ = reader.GetNested().GetNested().GetNested().GetNested().GetValue()
	})
	fmt.Printf("  Gremlin: %10d ns/op  %8d B/op  %6d allocs/op\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	result = runBenchmark("Google Full Access", *iterations, func() {
		reader := &google_pb.DeepNested{}
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
	fmt.Printf("  Google:  %10d ns/op  %8d B/op  %6d allocs/op\n\n", result.NsPerOp, result.BytesPerOp, result.AllocsPerOp)

	fmt.Println("===========================================")
	fmt.Println("✅ Benchmark Complete!")
	fmt.Println("===========================================")
}
