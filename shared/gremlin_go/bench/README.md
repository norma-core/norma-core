# Gremlin Benchmarks

This directory contains performance benchmarks comparing Gremlin against Google's standard protobuf implementation.

## Quick Start

```bash
# Fast benchmark (1 second per test, recommended for quick feedback)
make run-gobench

# Comprehensive benchmark (200K iterations default)
make run-bin
```

## Prerequisites

**To run benchmarks:** Only Go 1.25+ is required. Generated protobuf code is included in the repository.

**To regenerate protobuf code (optional):** If you want to regenerate the protobuf files:
- `protoc` (Protocol Buffer Compiler) - [Installation Guide](https://grpc.io/docs/protoc-installation/)
- `protoc-gen-go` plugin: `go install google.golang.org/protobuf/cmd/protoc-gen-go@latest`

## Running Benchmarks

### Makefile Targets

```bash
# Fast benchmarks using go test -bench (1 second per test)
make run-gobench

# Comprehensive benchmarks (200K iterations default)
make run-bin

# Custom iterations
make run-bin N=1000000
```

## Regenerating Protobuf Code

```bash
# Clean generated files
make clean

# Regenerate both Gremlin and Google protobuf code
make protobuf

# Or regenerate individually
make protobuf-gremlin
make protobuf-google
```

## Benchmark Structure

The benchmarks test two message types with 4 scenarios each:

### Message Types

1. **Deep Nested Messages**: Artificial deeply-nested structures (4+ levels)
2. **Golden Message**: Official protobuf test data (`protobuf_unittest.TestAllTypes`)

### Test Scenarios

1. **Marshal**: Serialize a message to wire format
2. **Unmarshal**: Deserialize wire format (but don't access fields)
3. **Root Access**: Unmarshal + access only root-level fields (shows lazy parsing benefit)
4. **Full Access**: Unmarshal + access all nested fields (worst case)

## Protobuf Definitions

- `protobufs/benchmark.proto` - Deep nested message definition
- `protobufs/unittest.proto` - Official protobuf unittest (golden message)
- `protobufs/unittest_import.proto` - Supporting unittest definitions
- `protobufs/unittest_import_public.proto` - Public unittest imports

Both Gremlin and Google implementations use identical proto definitions to ensure fair comparison.
