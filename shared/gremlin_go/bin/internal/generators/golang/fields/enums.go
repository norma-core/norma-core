package fields

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
)

type goEnumValueType struct {
	EnumName     string
	DefaultValue string
	Required     bool
}

func (e *goEnumValueType) ReaderTypeName() string {
	return e.EnumName
}
func (e *goEnumValueType) WriterTypeName() string {
	return e.ReaderTypeName()
}

func (e *goEnumValueType) resolveDefaultValue(field *types.MessageFieldDefinition, enumPackage string, enumType core.GoType) {
	if field.DefaultValue == nil {
		return
	}

	e.DefaultValue = enumPackage + enumType.GetEnumForDefault(field.DefaultValue.Constant.Source)
}

func (e *goEnumValueType) OffsetsType() string {
	return "int"
}

func (e *goEnumValueType) WireTypeType() string {
	return ""
}

func (e *goEnumValueType) CanBePacked() bool {
	return true // protobufjs uses packed enums
}

func (e *goEnumValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	return formatting.AddTabs(
		fmt.Sprintf(`m.offset%v = offset`, fieldName),
		tabs,
	)
}

func (e *goEnumValueType) EntryReader(tabs string, localVarName string) string {
	var res string
	if e.DefaultValue == "" {
		res = fmt.Sprintf(`
var %v %v
if wOffset > 0 {
	rawEntry := m.buf.ReadInt32(wOffset)
	%v = %v(rawEntry)
}
`, localVarName, e.EnumName, localVarName, e.EnumName)
	} else {
		res = fmt.Sprintf(`
var %v %v
if wOffset > 0 {
	rawEntry := m.buf.ReadInt32(wOffset)
	%v = %v(rawEntry)
} else {
	%v = %v
}
`, localVarName, e.EnumName, localVarName, e.EnumName, localVarName, e.DefaultValue)
	}

	return formatting.AddTabs(res, tabs)
}

func (e *goEnumValueType) EntrySizedReader(tabs string, localVarName string) string {
	var res string
	if e.DefaultValue == "" {
		res = fmt.Sprintf(`
var %v %v
var %vSize int
if wOffset > 0 {
	rawEntry, size := m.buf.SizedReadInt32(wOffset)
	%v = %v(rawEntry)
	%vSize = size
}
`, localVarName, e.EnumName, localVarName, localVarName, e.EnumName, localVarName)
	} else {
		res = fmt.Sprintf(`
var %v %v
var %vSize int
if wOffset > 0 {
	rawEntry, size := m.buf.SizedReadInt32(wOffset)
	%v = %v(rawEntry)
	%vSize = size
} else {
	%v = %v
}
`, localVarName, e.EnumName, localVarName, localVarName, e.EnumName, localVarName, localVarName, e.DefaultValue)
	}

	return formatting.AddTabs(res, tabs)
}

func (e *goEnumValueType) ToStruct(tabs string, targetVar string, readerField string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, readerField), tabs)
}

func (e *goEnumValueType) EntryIsNotEmpty(localVarName string) string {
	if e.Required {
		return "true"
	}
	var defaultValue = e.DefaultValue
	if defaultValue == "" {
		defaultValue = "0"
	}
	return fmt.Sprintf(`%v != %v`, localVarName, defaultValue)
}

func (e *goEnumValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, srcVar), tabs)
}

func (e *goEnumValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = gremlin.SizeTag(%v) + gremlin.SizeInt32(int32(%v))`, sizeVarName, fieldTag, fieldName), tabs)
}

func (e *goEnumValueType) EntryFullSizeWithoutTag(tabs string, sizeVarName string, fieldName string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = gremlin.SizeInt32(int32(%v))`, sizeVarName, fieldName), tabs)
}

func (e *goEnumValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v.AppendInt32(%v, int32(%v))`, targetBuffer, tag, varName), tabs)
}

func (e *goEnumValueType) PackedEntryWriter(tabs string, targetBuffer string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v.AppendInt32WithoutTag(int32(%v))`, targetBuffer, varName), tabs)
}

func (e *goEnumValueType) DefaultReturn() string {
	var defaultValue = e.DefaultValue
	if defaultValue == "" {
		defaultValue = "0"
	}
	return defaultValue
}

func (e *goEnumValueType) JsonStructCanBeUsedDirectly() bool {
	return true
}
