package internal

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"os"
	"sync"

	"github.com/emicklei/proto"
)

func ParseProtoFiles(files []*types.ProtoFile) error {
	wg := sync.WaitGroup{}
	wg.Add(len(files))

	var errors = make([]error, len(files))

	for i := range files {
		go func(i int) {
			defer wg.Done()
			path := files[i].Path
			file, err := os.Open(path)
			if err != nil {
				errors[i] = err
				return
			}
			defer file.Close()

			parsed, err := proto.NewParser(file).Parse()
			if err != nil {
				errors[i] = err
				return
			}

			files[i].Parsed = parsed
		}(i)
	}
	wg.Wait()

	for i, err := range errors {
		if err != nil {
			return fmt.Errorf("failed to parse %v: %v", files[i], err)
		}
	}

	return nil
}
