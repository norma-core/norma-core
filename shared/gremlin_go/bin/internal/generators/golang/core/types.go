package core

import (
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"strings"
)

type GoFieldType interface {
	ReaderTypeName() string
	WriterTypeName() string

	OffsetsType() string
	WireTypeType() string
	CanBePacked() bool

	EntrySizedReader(tabs string, localVarName string) string       // should produce entry and entrySize variables
	EntryReader(tabs string, localVarName string) string            // should produce entry
	EntryUnmarshalSaveOffsets(tabs string, fieldName string) string // should set m.offset%v, m.wireType%v, etc if needed
	DefaultReturn() string

	ToStruct(tabs string, targetVar string, readerField string) string
	EntryCopy(tabs string, targetVar string, srcVar string) string
	JsonStructCanBeUsedDirectly() bool

	EntryIsNotEmpty(localVarName string) string
	EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string
	EntryFullSizeWithoutTag(tabs string, sizeVarName string, fieldName string) string

	EntryWriter(tabs string, targetBuffer string, tag string, varName string) string
	PackedEntryWriter(tabs string, targetBuffer string, varName string) string
}

type GoType interface {
	GetName() string
	IsEnum(enumDef *types.EnumDefinition) bool
	IsStruct(structDef *types.MessageDefinition) bool
	GetEnumForDefault(value string) string

	GenerateCode(sb *strings.Builder)
}
