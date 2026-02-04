package fields

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"log"
)

type goRepeatedValueType struct {
	RepeatedType core.GoFieldType
	Required     bool
}

func (t *goRepeatedValueType) ReaderTypeName() string {
	return fmt.Sprintf("[]%v", t.RepeatedType.ReaderTypeName())
}

func (t *goRepeatedValueType) WriterTypeName() string {
	return fmt.Sprintf("[]%v", t.RepeatedType.WriterTypeName())
}

func (t *goRepeatedValueType) OffsetsType() string {
	return "[]int"
}

func (t *goRepeatedValueType) WireTypeType() string {
	if t.RepeatedType.CanBePacked() {
		return "[]gremlin.ProtoWireType"
	} else {
		return ""
	}
}

func (t *goRepeatedValueType) CanBePacked() bool {
	return false
}

func (t *goRepeatedValueType) EntrySizedReader(string, string) string {
	return ""
}

func (t *goRepeatedValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	return formatting.AddTabs(fmt.Sprintf(`m.offset%v = append(m.offset%v, offset)`, fieldName, fieldName), tabs)
}

func (t *goRepeatedValueType) EntryReader(tabs string, localVarName string) string {
	var res = fmt.Sprintf(`
var %v %v
for i := 0; i < len(wOffset); i++ {
	wOffset := wOffset[i]
%v
	%v = append(%v, listEntry)
}
`, localVarName, t.ReaderTypeName(),
		t.RepeatedType.EntryReader("\t", "listEntry"),
		localVarName, localVarName)

	return formatting.AddTabs(res, tabs)
}

func (t *goRepeatedValueType) ToStruct(tabs string, targetVar string, readerField string) string {
	res := fmt.Sprintf(`if len(%v) > 0 {
	%v = make(%v, len(%v))
	for i := range %v {
%v
	}
}`, readerField, targetVar, t.WriterTypeName(), readerField, readerField,
		t.RepeatedType.ToStruct("\t\t", targetVar+"[i]", readerField+"[i]"),
	)

	return formatting.AddTabs(res, tabs)
}

func (t *goRepeatedValueType) EntryIsNotEmpty(localVarName string) string {
	if t.Required {
		return "true"
	}
	return fmt.Sprintf(`len(%v) > 0`, localVarName)
}

func (t *goRepeatedValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = 0
for _, val := range %v {
	var listEntrySize int
%v
	%v += listEntrySize
}`, sizeVarName, fieldName, t.RepeatedType.EntryFullSizeWithTag("\t", "listEntrySize", "val", fieldTag),
		sizeVarName), tabs)
}

func (t *goRepeatedValueType) EntryFullSizeWithoutTag(string, string, string) string {
	log.Panicf("EntryFullSizeWithoutTag should not be called on a repeated value type")
	return ""
}

func (t *goRepeatedValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`for _, entry := range %v {
%v
}`, varName, t.RepeatedType.EntryWriter("\t", targetBuffer, tag, "entry")), tabs)
}

func (t *goRepeatedValueType) PackedEntryWriter(string, string, string) string {
	log.Panicf("PackedEntryWriter should not be called on a repeated value type")
	return ""
}

func (t *goRepeatedValueType) DefaultReturn() string {
	return "nil"
}

func (t *goRepeatedValueType) JsonStructCanBeUsedDirectly() bool {
	return t.RepeatedType.JsonStructCanBeUsedDirectly()
}

func (t *goRepeatedValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	if t.RepeatedType.JsonStructCanBeUsedDirectly() {
		return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, srcVar), tabs)
	} else {
		return formatting.AddTabs(fmt.Sprintf(`%v = make(%v, len(%v))
for i := range %v {
%v
}`, targetVar, t.WriterTypeName(), srcVar, srcVar, t.RepeatedType.EntryCopy("\t", targetVar+"[i]", srcVar+"[i]")), tabs)
	}
}
