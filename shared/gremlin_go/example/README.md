# Gremlin Example

This example demonstrates how to use gremlin_go for high-performance protobuf serialization.

## Quick Start

```bash
# Generate Go code from proto files
make generate

# Run the example
make run
```

## What This Example Shows

1. **Single-Allocation Serialization**: Marshaling allocates only once, regardless of message complexity
2. **Lazy Parsing**: Nested messages are parsed on-demand, not upfront
3. **Null-Safe Getters**: Access deeply nested fields without nil checks
4. **Zero-Copy Reading**: Read fields directly from the wire format
5. **Efficient Maps and Repeated Fields**: Optimized handling of collections

## Project Structure

```
example/
├── proto/           # Protobuf definitions
│   └── user.proto
├── generated/       # Generated Go code (created by make generate)
├── main.go          # Example application
├── Makefile         # Build commands
└── README.md
```

## Manual Generation

If you prefer not to use make:

```bash
go run ../gremlinc/main.go \
  -src ./proto \
  -out ./generated \
  -module github.com/norma-core/norma-core/shared/gremlin_go/example/generated
```

## Key Features Demonstrated

### Creating Messages

```go
user := &example.User{
    Id:       1001,
    Username: "johndoe",
    Email:    "john@example.com",
    Active:   true,
    Tags:     []string{"developer", "golang"},
    Profile: &example.Profile{
        FullName: "John Doe",
        Age:      30,
    },
}
```

### Serialization (Marshal)

```go
data := user.Marshal()  // Single allocation
```

### Deserialization (Unmarshal)

```go
reader := example.NewUserReader()
if err := reader.Unmarshal(data); err != nil {
    ...
}
```

### Accessing Fields

```go
// Root fields
id := reader.GetId()
username := reader.GetUsername()

// Nested fields with null-safe chaining
city := reader.GetProfile().GetAddress().GetCity()

// Collections
tags := reader.GetTags()
metadata := reader.GetMetadata()
```

### Converting to Mutable Struct

```go
user := reader.ToStruct()

// Now you can mutate
user.Username = "new_username"
```

## Learn More

- See `../bench/` for detailed performance benchmarks
- Check `../gremlinc/` for the code generator
- Visit the root `../README.md` for complete documentation
