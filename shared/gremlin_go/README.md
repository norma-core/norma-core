# 🚀 Gremlin - High-Performance Protobuf for Go

Gremlin is a blazingly fast Protocol Buffers implementation for Go that outperforms the standard Google protobuf library by up to **23x** while providing a superior developer experience.

## ⚡ Why Gremlin?

### Performance That Matters

**🍎 Apple M3 Max** (16 cores, 10M iterations):

| Operation | Gremlin 🚀 | Google Protobuf | Speedup |
|-----------|------------|-----------------|---------|
| 🔨 **Marshal** | 1,749 ns/op | 2,281 ns/op | **1.3x** |
| ⚡ **Unmarshal** | 253 ns/op | 4,541 ns/op | **18x** |
| 🎯 **Lazy Read** | 269 ns/op | 4,523 ns/op | **17x** |
| 🔍 **Deep Access** | 833 ns/op | 4,518 ns/op | **5.4x** |

**😈 FreeBSD** - AMD Ryzen 5 7600X (12 cores, 10M iterations):

| Operation | Gremlin 🚀 | Google Protobuf | Speedup |
|-----------|------------|-----------------|---------|
| 🔨 **Marshal** | 1,554 ns/op | 1,998 ns/op | **1.3x** |
| ⚡ **Unmarshal** | 234 ns/op | 4,144 ns/op | **18x** |
| 🎯 **Lazy Read** | 254 ns/op | 4,142 ns/op | **16x** |
| 🔍 **Deep Access** | 776 ns/op | 4,160 ns/op | **5.4x** |

**💻 Framework 16 with Ubuntu** - AMD Ryzen AI 9 HX 370 (24 cores, 10M iterations):

| Operation | Gremlin 🚀 | Google Protobuf | Speedup |
|-----------|------------|-----------------|---------|
| 🔨 **Marshal** | 1,436 ns/op | 1,919 ns/op | **1.3x** |
| ⚡ **Unmarshal** | 207 ns/op | 3,880 ns/op | **19x** |
| 🎯 **Lazy Read** | 229 ns/op | 3,877 ns/op | **17x** |
| 🔍 **Deep Access** | 692 ns/op | 3,867 ns/op | **5.6x** |

**🥧 Raspberry Pi 5** - Gentoo Linux (ARM64, 4 cores, 10M iterations):

| Operation | Gremlin 🚀 | Google Protobuf | Speedup |
|-----------|------------|-----------------|---------|
| 🔨 **Marshal** | 6,520 ns/op | 7,954 ns/op | **1.2x** |
| ⚡ **Unmarshal** | 1,080 ns/op | 23,387 ns/op | **22x** |
| 🎯 **Lazy Read** | 1,078 ns/op | 24,245 ns/op | **23x** |
| 🔍 **Deep Access** | 3,924 ns/op | 22,998 ns/op | **5.9x** |

**Memory Efficiency:**
- Marshal: **1 allocation** (vs 1 allocation)
- Unmarshal: **9 allocations** (vs 129 allocations - 14.3x fewer!)
- Full access: **29 allocations** (vs 129 allocations - 4.4x fewer!)

### 🎯 Core Benefits

- ✅ **No `protoc` Required** - Pure Go code generation
- ✅ **Lazy Parsing by Default** - All nested messages are parsed on-demand, not upfront
- ✅ **Null-Safe Getters** - Chain deeply nested field access without nil checks or panics
- ✅ **Zero-Copy Reading** - Read fields directly from wire format without intermediate allocations
- ✅ **Drop-in Compatibility** - Use the same `.proto` files as standard protobuf

## 📦 Installation

```bash
# Install the code generator
go install github.com/norma-core/norma-core/shared/gremlin_go/gremlinc@latest

# Add runtime library to your project
go get github.com/norma-core/norma-core/shared/gremlin_go
```

## 🚀 Quick Start

### 1. Define Your Protobuf

Create `user.proto`:

```protobuf
syntax = "proto3";
package example;

message User {
  int64 id = 1;
  string username = 2;
  string email = 3;
  Profile profile = 4;
}

message Profile {
  string full_name = 1;
  int32 age = 2;
}
```

### 2. Generate Go Code

```bash
# Generate code
gremlinc -src ./proto -out ./generated -module yourmodule/generated

# Or use it in your Makefile
protobuf:
	gremlinc -src ./proto -out ./generated -module github.com/yourorg/yourproject/generated
```

### 3. Use in Your Code

```go
package main

import (
    "fmt"
    "yourmodule/generated/example"
)

func main() {
    // Create and serialize
    user := &example.User{
        Id:       1001,
        Username: "johndoe",
        Email:    "john@example.com",
        Profile: &example.Profile{
            FullName: "John Doe",
            Age:      30,
        },
    }

    data := user.Marshal() // no errors!

    // Deserialize and read
    reader := example.NewUserReader()
    if err := reader.Unmarshal(data); err != nil {
        panic(err)
    }

    // Null-safe access - no panics!
    fmt.Printf("ID: %d\n", reader.GetId())
    fmt.Printf("Username: %s\n", reader.GetUsername())
    fmt.Printf("Full Name: %s\n", reader.GetProfile().GetFullName())  // Lazy parsing

    // Convert to mutable struct when needed
    mutableUser := reader.ToStruct()
    mutableUser.Username = "updated"
    fmt.Printf("Updated username: %s\n", mutableUser.Username)
}
```

## 📊 Benchmark Details

All benchmarks use complex deeply-nested messages (4+ levels deep with repeated fields, maps, and byte arrays). Run on real hardware across multiple platforms with 10M iterations per test. See [bench/](bench/) for full benchmark code.

**Test Scenarios:**
- 🔨 **Marshal**: Serialize a message to wire format
- ⚡ **Unmarshal**: Deserialize wire format (but don't access fields)
- 🎯 **Lazy Read**: Unmarshal + access only root-level fields (shows lazy parsing benefit)
- 🔍 **Deep Access**: Unmarshal + access all nested fields (worst case for lazy parsing)

**Why Gremlin is Faster:**
- **Static code generation**: No reflection overhead, all field access is direct
- **Lazy parsing**: Nested messages stay as raw bytes until accessed
- **Zero-copy reads**: Scalars read directly from wire format without intermediate buffers
- **Efficient memory layout**: Readers are lightweight wrappers around byte slices

**Run Benchmarks Yourself:**
```bash
cd bench
make run-gobench    # Fast benchmarks using go test (1 second per test)
make run-bin        # Comprehensive benchmarks (200K iterations)
```

## 🎓 Examples

Check out the [example/](example/) directory for a complete working project:

- Simple proto definitions
- Nested messages, maps, and repeated fields
- Full serialization/deserialization flow
- Null-safe field access patterns
- Conversion between reader and mutable structs

```bash
cd example
make run
```

## 🛠️ Generator Options

```bash
gremlin [options]

Options:
  -src string
        Source path where proto files are located (required)

  -out string
        Output path for generated files (required)

  -module string
        Go module path for generated imports
        Example: github.com/yourorg/project/generated

  -ignore string
        Comma-separated list of directories to ignore
        Default: node_modules,vendor,test_data,.git
```

## 🏗️ Project Structure

```
gremlin_go/
├── README.md           # This file
├── interface.go        # Core interfaces
├── reader.go           # Wire format reader
├── writer.go           # Wire format writer
├── gremlinc/           # Code generator
│   └── main.go
├── example/            # Working example project
│   ├── main.go
│   └── proto/
└── bench/              # Performance benchmarks
    └── benchmark_test.go
```

### Running Tests

```bash
# Runtime library tests
go test ./...

# Generator tests
cd gremlinc
go run . -src ./testproto -out ./testpb -module github.com/norma-core/norma-core/shared/gremlin_go/gremlinc/testpb
go test ./internal/...

# Benchmarks
cd bench
make run-gobench    # Fast benchmarks
make run-bin        # Comprehensive benchmarks
```

## 📝 Features

- ✅ Proto2 and Proto3 syntax
- ✅ Scalar types (int32, int64, uint32, uint64, bool, string, bytes, float, double)
- ✅ Nested messages
- ✅ Repeated fields
- ✅ Maps
- ✅ Enums
- ✅ Packages and imports
- ✅ Default values
- ✅ Wire format compatibility with standard protobuf
- ❌ gRPC (protobuf wire format only)

## 🎯 Use Cases

Perfect for:
- 🚄 High-throughput services where every microsecond counts
- 📦 Large message processing with selective field access
- 🔋 Memory-constrained environments
- 🎮 Real-time applications (gaming, streaming, IoT)
- 📊 Data pipelines processing millions of messages
- 🌐 Microservices with strict performance requirements

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with performance and developer experience as top priorities. Inspired by the need for faster protobuf processing in high-performance Go applications.