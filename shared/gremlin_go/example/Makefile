.PHONY: generate run clean

generate:
	@echo "Generating protobuf code..."
	@cd ../gremlinc && go run . -src ../example/proto -out ../example/generated -module github.com/norma-core/norma-core/shared/gremlin_go/example/generated

run: generate
	@echo "Running example..."
	@go run main.go

clean:
	@echo "Cleaning generated files..."
	@rm -rf generated
