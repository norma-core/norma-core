.PHONY: generate run clean

generate:
	@echo "Generating protobuf code..."
	@mkdir -p generated
	@go run ../bin/gremlin.go -src ./proto -out ./generated -module github.com/norma-core/norma-core/shared/gremlin_go/example/generated

run: generate
	@echo "Running example..."
	@go run main.go

clean:
	@echo "Cleaning generated files..."
	@rm -rf generated
