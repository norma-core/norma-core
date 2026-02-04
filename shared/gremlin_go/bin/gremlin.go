package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/logrusorgru/aurora"

	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang"
)

var srcPath = flag.String("src", "", "source path where proto files are located")
var outPath = flag.String("out", "", "output path for generated files")
var modulePath = flag.String("module", "", "go module path for generated imports (e.g. github.com/user/repo/generated)")
var ignorePatterns = flag.String("ignore", "", "comma-separated list of directory names to ignore (defaults: node_modules,vendor,test_data,.git)")

func main() {
	flag.Parse()

	t := time.Now()

	var protoDir = *srcPath
	if protoDir == "" {
		log.Fatal("Missing required flag: -src (source path where proto files are located)")
	}

	var targetDir = *outPath
	if targetDir == "" {
		log.Fatal("Missing required flag: -out (output path for generated files)")
	}

	if err := internal.CreateTargetFolder(targetDir); err != nil {
		panic(err.Error())
	}

	var ignore []string
	if *ignorePatterns != "" {
		ignore = strings.Split(*ignorePatterns, ",")
		for i := range ignore {
			ignore[i] = strings.TrimSpace(ignore[i])
		}
	} else {
		ignore = internal.DefaultIgnorePatterns
	}

	targets, err := internal.FindAllProtobufFiles(protoDir, ignore)
	if err != nil {
		panic(err.Error())
	}

	if err := internal.ParseProtoFiles(targets); err != nil {
		panic(err.Error())
	}

	errors := internal.ParseStruct(targets)
	if len(errors) > 0 {
		for _, err = range errors {
			fmt.Printf("%v: %v\n", aurora.Red("ERR"), err.Error())
		}
		os.Exit(-1)
	}

	errors = internal.ResolveImportsAndReferences(targets)
	if len(errors) > 0 {
		for _, err = range errors {
			fmt.Printf("%v: %v\n", aurora.Red("ERR"), err.Error())
		}
		os.Exit(-1)
	}

	fmt.Printf("All files parsed and analyzed in %v\n", aurora.Yellow(time.Since(t).Truncate(time.Millisecond)))
	fmt.Printf("Generating golang files...\n")

	errors = golang.Generate(targetDir, *modulePath, targets)
	if len(errors) > 0 {
		for _, err = range errors {
			fmt.Printf("%v: %v\n", aurora.Red("ERR"), err.Error())
		}
		os.Exit(-1)
	}

	fmt.Printf("Done in %v\n", aurora.Yellow(time.Since(t).Truncate(time.Millisecond).Truncate(time.Millisecond)))
}
