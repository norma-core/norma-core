package mapper

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/fields"
	gotypes "github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/types"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"path/filepath"
	"strings"
)

func MapProtoFiles(root string, modulePath string, files []*types.ProtoFile) ([]*core.GoGeneratedFile, []error) {
	var result = make([]*core.GoGeneratedFile, len(files))
	var errors []error

	for i, target := range files {
		shortName, fullName := getGoPackage(root, modulePath, target)
		if shortName == "" || fullName == "" {
			errors = append(errors, fmt.Errorf("unable to get package for file %v", target.RelativePath))
			continue
		}

		goFile := &core.GoGeneratedFile{
			ProtoFile:        files[i],
			FullPackageName:  fullName,
			ShortPackageName: shortName,
		}
		result[i] = goFile
	}

	errors = append(errors, mapImports(result)...)
	if len(errors) > 0 {
		return nil, errors
	}

	for i, target := range result {
		result[i].FullOutputPath = buildOutputPath(root, target)
	}

	// now we have package names, imports and aliases for imports
	var structs [][]*gotypes.GoStructType
	for i := range result {
		goFile := result[i]
		var fileStructs []*gotypes.GoStructType
		for j := range goFile.ProtoFile.Enums {
			enumDef := goFile.ProtoFile.Enums[j]
			goFile.AddEnum(gotypes.NewEnumType(enumDef))
		}
		for j := range goFile.ProtoFile.Messages {
			messageDef := goFile.ProtoFile.Messages[j]
			goStruct := gotypes.NewStructType(messageDef)
			goFile.AddStruct(goStruct)
			fileStructs = append(fileStructs, goStruct)
		}
		structs = append(structs, fileStructs)
	}

	// last step - map fields
	for i := range result {
		goFile := result[i]
		for j := range goFile.ProtoFile.Messages {
			goMessageDef := structs[i][j]
			for k := range goFile.ProtoFile.Messages[j].Fields {
				fieldDef := goFile.ProtoFile.Messages[j].Fields[k]
				fieldType, err := fields.ResolveType(goFile, fieldDef)
				if err != nil {
					errors = append(errors, fmt.Errorf("file: %v, %w", goFile.ProtoFile.RelativePath, err))
					continue
				}

				goMessageDef.AddField(fieldDef, fieldType)
			}
		}
	}

	return result, errors
}

func getGoPackage(outBase string, modulePath string, target *types.ProtoFile) (string, string) {
	var pkgName = filepath.Dir(target.RelativePath)
	var protoName = ""
	if target.Package != nil {
		protoName = target.Package.Name.ProtoName()
	}

	if target.Package == nil || target.Package.Name.PlatformName(types.TargetPlatform_Go) == "" {
		var shortName = filepath.Base(pkgName)
		if target.Package != nil && protoName != "" {
			pkgName = filepath.Join(pkgName, target.Package.Name.ProtoName())
			shortName = target.Package.Name.ProtoName()
		}

		// If modulePath is provided, use it for import paths
		if modulePath != "" {
			// Remove leading dot from relative paths
			pkgName = strings.TrimPrefix(pkgName, ".")
			pkgName = strings.TrimPrefix(pkgName, string(filepath.Separator))
			pkgName = filepath.Join(modulePath, pkgName)
		} else {
			// Legacy behavior: use filesystem-based path
			pkgName = strings.TrimPrefix(pkgName, outBase)
			pkgName = filepath.Join(filepath.Base(outBase), pkgName)
		}

		return cleanupPackageName(shortName), pkgName
	} else {
		var pkg = target.Package.Name.PlatformName(types.TargetPlatform_Go)
		var shortName = filepath.Base(pkg)
		return cleanupPackageName(shortName), pkg
	}
}

func cleanupPackageName(name string) string {
	name = strings.ReplaceAll(name, "-", "_")
	name = strings.ReplaceAll(name, ".", "_")
	return name
}

func buildOutputPath(root string, pFile *core.GoGeneratedFile) string {
	fName := filepath.Base(pFile.ProtoFile.RelativePath)
	fName = strings.TrimSuffix(fName, types.ProtoExtension)
	fName = fmt.Sprintf("%v%v", fName, types.PbGoExtension)

	// Build output path based on proto file's relative directory structure, not import path
	pkgDir := filepath.Dir(pFile.ProtoFile.RelativePath)

	// Add proto package name as subdirectory if it exists
	if pFile.ProtoFile.Package != nil {
		protoName := pFile.ProtoFile.Package.Name.ProtoName()
		if protoName != "" {
			pkgDir = filepath.Join(pkgDir, protoName)
		}
	}

	// Remove leading dot and separator
	pkgDir = strings.TrimPrefix(pkgDir, ".")
	pkgDir = strings.TrimPrefix(pkgDir, string(filepath.Separator))

	res := filepath.Join(root, pkgDir, fName)
	return res
}
