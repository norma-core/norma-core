package internal

import (
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

var DefaultIgnorePatterns = []string{
	"node_modules",
	"vendor",
	"test_data",
	".git",
}

func FindAllProtobufFiles(cwd string, ignorePatterns []string) ([]*types.ProtoFile, error) {
	ignoreMap := make(map[string]struct{}, len(ignorePatterns))
	for _, pattern := range ignorePatterns {
		ignoreMap[pattern] = struct{}{}
	}
	// Convert to absolute path
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return nil, err
	}

	var files []*types.ProtoFile
	if err := filepath.WalkDir(absCwd, func(filePath string, info fs.DirEntry, err error) error {
		if info.IsDir() || !strings.HasSuffix(filePath, types.ProtoExtension) {
			return nil
		}
		pathParts := strings.Split(filePath, string(os.PathSeparator))
		for _, part := range pathParts {
			if _, ignored := ignoreMap[part]; ignored {
				return nil
			}
		}

		pFile := &types.ProtoFile{Path: filePath}
		pFile.RelativePath = buildRelativePath(absCwd, pFile)

		files = append(files, pFile)

		return err
	}); err != nil {
		return nil, err
	}

	return files, nil
}

func buildRelativePath(root string, pFile *types.ProtoFile) string {
	if !strings.HasPrefix(pFile.Path, root) {
		log.Panicf("non-root relative path: %v", pFile.Path)
	}

	relative := strings.TrimPrefix(pFile.Path, root)
	relative = strings.TrimPrefix(relative, string(os.PathSeparator))
	return relative
}

func CreateTargetFolder(targetPath string) error {
	return os.MkdirAll(targetPath, 0755)
}
