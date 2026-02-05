.PHONY: protobuf protobuf-gremlin protobuf-google clean run-bin run-gobench

# Generate all protobuf code (both Gremlin and Google)
protobuf: protobuf-gremlin protobuf-google

# Generate Gremlin protobuf code
protobuf-gremlin:
	@echo "Generating Gremlin protobuf code..."
	@cd ../gremlinc && go run . -src ../bench/protobufs -out ../bench/gremlin_pb -module github.com/norma-core/norma-core/shared/gremlin_go/bench/gremlin_pb
	@echo "✅ Gremlin protobuf code generated"

# Generate Google protobuf code
protobuf-google:
	@echo "Generating Google protobuf code..."
	@mkdir -p google_pb/benchmark google_pb/unittest
	@protoc -I./protobufs \
		--go_out=./google_pb/benchmark --go_opt=paths=source_relative \
		--go_opt=Mbenchmark.proto=github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/benchmark \
		protobufs/benchmark.proto
	@protoc -I./protobufs \
		--go_out=./google_pb/unittest --go_opt=paths=source_relative \
		--go_opt=Munittest.proto=github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest \
		--go_opt=Munittest_import.proto=github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest \
		--go_opt=Munittest_import_public.proto=github.com/norma-core/norma-core/shared/gremlin_go/bench/google_pb/unittest \
		protobufs/unittest.proto protobufs/unittest_import.proto protobufs/unittest_import_public.proto
	@echo "✅ Google protobuf code generated"

# Clean generated files
clean:
	@echo "Cleaning generated protobuf files..."
	@rm -rf gremlin_pb google_pb
	@echo "✅ Cleaned"

# Run standalone benchmark binary (all benchmarks)
# Usage: make run-bin N=1000000 (defaults to 200000)
run-bin:
	@echo "Building and running standalone benchmark binary..."
	@go build -o gremlin-bench ./cmd/benchmark
	@./gremlin-bench -n $(or $(N),200000)
	@rm -f gremlin-bench

# Run Go test benchmarks (shorter, for quick testing)
run-gobench:
	@echo "Running Go test benchmarks..."
	@go test -bench=. -benchmem -benchtime=1s
