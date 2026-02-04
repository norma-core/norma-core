/*
               .'\   /`.
             .'.-.`-'.-.`.
        ..._:   .-. .-.   :_...
      .'    '-.(o ) (o ).-'    `.
     :  _    _ _`~(_)~`_ _    _  :
    :  /:   ' .-=_   _=-. `   ;\  :
    :   :|-.._  '     `  _..-|:   :
     :   `:| |`:-:-.-:-:'| |:'   :
      `.   `.| | | | | | |.'   .'
        `.   `-:_| | |_:-'   .'
          `-._   ````    _.-'
              ``-------''

Created by ab, 27.09.2022
*/

package internal

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"log"
	"path/filepath"
	"strings"

	"github.com/logrusorgru/aurora"
)

func ResolveImportsAndReferences(parsed []*types.ProtoFile) []error {
	if err := resolveBaseFolders(parsed); err != nil {
		return []error{err}
	}

	parsedMap := map[string]*types.ProtoFile{}
	for _, p := range parsed {
		p := p
		parsedMap[p.Path] = p
	}

	var errors []error

	for i := range parsed {
		file := parsed[i]
		errors = append(errors, resolveImports(file, parsedMap)...)
	}

	for i := range parsed {
		addPublicImports(parsed[i])
	}

	for i := range parsed {
		errors = append(errors, resolveExtensions(parsed[i])...)
	}

	for i := range parsed {
		errors = append(errors, resolveReferences(parsed[i])...)
	}

	for i := range parsed {
		errors = append(errors, resolveOptions(parsed[i])...)
	}

	return errors
}

func addPublicImports(pFile *types.ProtoFile) {
	for _, imp := range pFile.Imports {
		if imp.TargetFile == nil {
			log.Printf("WARN: Target file not resolved for %v in %v\n",
				aurora.Cyan(imp.FSPath),
				aurora.Cyan(pFile.RelativePath))
			continue
		}
		for _, targetImport := range imp.TargetFile.Imports {
			if targetImport.ProtoDef.Kind == "public" {
				pFile.Imports = append(pFile.Imports, targetImport)
			}
		}
	}
}

func resolveImports(pFile *types.ProtoFile, parsed map[string]*types.ProtoFile) []error {
	if len(pFile.Imports) == 0 {
		return nil
	}

	var errors []error

	for _, imp := range pFile.Imports {
		path := filepath.Join(pFile.BaseFolder, imp.FSPath)
		imp := imp

		if _, found := parsed[path]; found {
			imp.TargetFile = parsed[path]
		} else {
			errors = append(errors, fmt.Errorf("failed to resolve `%v`\nSource: %v\nRoot: %v\nPath: %v",
				aurora.Red("import "+imp.FSPath),
				pFile.RelativePath,
				aurora.Red(pFile.BaseFolder),
				aurora.Cyan(path)))
		}
	}

	return errors
}

type fsNode struct {
	Path     string
	Children []*fsNode
	Files    []*types.ProtoFile
}

// used for correct path calc for imports.
// all imports will be resolved as baseFolder + importPath
// we need to determine common root for protobuf files
func resolveBaseFolders(parsed []*types.ProtoFile) error {
	rootNode := &fsNode{
		Path: string(filepath.Separator),
	}

	for _, p := range parsed {
		currentDir := rootNode

		pathParts := strings.Split(filepath.Dir(p.Path), string(filepath.Separator))
		for _, part := range pathParts {
			if part == "" {
				continue
			}
			foundChild := false
			for _, child := range currentDir.Children {
				if child.Path == filepath.Join(currentDir.Path, part) {
					foundChild = true
					currentDir = child
					break
				}
			}
			if !foundChild {
				newNode := &fsNode{
					Path: filepath.Join(currentDir.Path, part),
				}
				currentDir.Children = append(currentDir.Children, newNode)
				currentDir = newNode
			}
		}

		p := p
		currentDir.Files = append(currentDir.Files, p)
	}

	for len(rootNode.Children) > 0 && len(rootNode.Children) == 1 && len(rootNode.Files) == 0 {
		rootNode = rootNode.Children[0]
	}

	// Validate we have a proper structure:
	// Either: subdirectories with proto files (multi-package)
	// Or: files at this level with no subdirectories (single-package)
	hasChildren := len(rootNode.Children) > 0
	hasFiles := len(rootNode.Files) > 0

	if !hasChildren && !hasFiles {
		// No files and no subdirectories - empty structure
		log.Fatalf(`
No proto files or subdirectories found at build path.
Here is what we see at the very system root of OS we're building on: %v
`, rootNode.Path)
	}

	if hasFiles && hasChildren {
		// Files at root level AND subdirectories - ambiguous structure
		log.Fatalf(`
Found both proto files and subdirectories at the same level.
This creates ambiguous import paths. Please organize proto files either:
  - All in subdirectories (multi-package)
  - All at the same level (single-package)
Path: %v
`, rootNode.Path)
	}

	fmt.Printf("Found root for all protobufs: %v, total proto files: %v\n", aurora.Cyan(rootNode.Path), aurora.Cyan(len(parsed)))

	assignBaseFolder(rootNode)

	return nil
}

func assignBaseFolder(rootNode *fsNode) {
	// If we have files at root level (single-package case), assign BaseFolder to them
	if len(rootNode.Files) > 0 {
		for _, file := range rootNode.Files {
			file.BaseFolder = rootNode.Path
		}
	}

	// For multi-package case, assign BaseFolder per subdirectory
	for _, child := range rootNode.Children {
		recursivelyAssignImportBaseFolder(child, child.Path)
	}
}

func recursivelyAssignImportBaseFolder(rootNode *fsNode, basePath string) {
	for _, file := range rootNode.Files {
		file := file
		file.BaseFolder = basePath
	}
	for _, child := range rootNode.Children {
		child := child
		recursivelyAssignImportBaseFolder(child, basePath)
	}
}
