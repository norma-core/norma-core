# Gremlin Benchmarks

This directory contains performance benchmarks comparing Gremlin against Google's standard protobuf implementation.

## Prerequisites

- Go 1.25+ installed
- `protoc` (Protocol Buffer Compiler) installed
- Gremlin generator installed

## Building Protobuf Code

Before running benchmarks, you need to generate the Go code from the `.proto` files.

### 1. Generate Google Protobuf Code

```bash
# Install protoc-gen-go if not already installed
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest

# Generate Google protobuf code
protoc --go_out=. --go_opt=paths=source_relative \
    google_pb/protobufs/benchmark.proto
```

### 2. Generate Gremlin Code

```bash
# Install gremlin generator if not already installed
go install github.com/norma-core/norma-core/shared/gremlin_go/bin@latest

# Generate Gremlin code
gremlin -src ./gremlin_pb -out ./gremlin_pb -module github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb
```

## Running Benchmarks

### Go Test Benchmarks

Run the standard Go benchmarks:

```bash
go test -bench=. -benchmem
```

Run specific benchmarks:

```bash
# Marshal benchmarks only
go test -bench=Marshal -benchmem

# Unmarshal benchmarks only
go test -bench=Unmarshal -benchmem

# Lazy parsing benchmarks
go test -bench=RootOnly -benchmem
```

### Standalone Benchmark Binary

Build and run the standalone benchmark binary:

```bash
# Build for current platform
go build -o gremlin-bench ./cmd/benchmark

# Run with default settings (10M iterations)
./gremlin-bench

# Run with custom iterations
./gremlin-bench -n 1000000
```

### Cross-Platform Binaries

Build binaries for multiple platforms:

```bash
./build.sh
```

This creates binaries in `binaries/`:
- `gremlin-bench-freebsd-amd64`
- `gremlin-bench-linux-amd64`
- `gremlin-bench-linux-arm64`
- `gremlin-bench-darwin-arm64`

Transfer the appropriate binary to your target device and run it:

```bash
./gremlin-bench-linux-arm64 -n 10000000
```

## Benchmark Structure

The benchmarks test 4 scenarios with complex deeply-nested messages:

1. **Marshal**: Serialize a message to wire format
2. **Unmarshal**: Deserialize wire format (but don't access fields)
3. **Root Access**: Unmarshal + access only root-level fields (shows lazy parsing benefit)
4. **Full Access**: Unmarshal + access all nested fields (worst case)

## Test Data

Test messages are defined in `bench_data.go`:
- `CreateDeepNestedGremlin()` - Creates a Gremlin message
- `CreateDeepNestedGoogle()` - Creates an identical Google protobuf message

Both create the same structure:
- 4+ levels of nesting
- Repeated fields
- Maps
- Byte arrays
- Multiple data types

## Protobuf Definitions

- `google_pb/protobufs/benchmark.proto` - Standard protobuf definition for Google's implementation
- `gremlin_pb/benchmark.proto` - Same definition used by Gremlin generator

Both use identical proto definitions to ensure fair comparison.
