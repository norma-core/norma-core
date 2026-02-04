package mapper

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
)

func mapImports(goFiles []*core.GoGeneratedFile) []error {
	var errors []error

	for i := range goFiles {
		goFile := goFiles[i]
		protoFile := goFile.ProtoFile

		for j := range protoFile.Imports {
			importedGoFile := findImportedGoFile(goFiles, protoFile.Imports[j])
			if importedGoFile == nil {
				errors = append(errors,
					fmt.Errorf("unable to find go file for import %v in %v",
						protoFile.Imports[j].TargetFile.RelativePath,
						protoFile.Package))
				continue
			}

			goFile.AddProtoImport(importedGoFile)
		}
	}

	return errors
}

func findImportedGoFile(goFiles []*core.GoGeneratedFile, importDef *types.ProtoImport) *core.GoGeneratedFile {
	for i := range goFiles {
		if goFiles[i].ProtoFile == importDef.TargetFile {
			return goFiles[i]
		}
	}
	return nil
}
