package fields

import (
	"fmt"
	"log"

	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
)

type goRepeatedPackedValueType struct {
	RepeatedType core.GoFieldType
	Required     bool
}

func (t *goRepeatedPackedValueType) ReaderTypeName() string {
	return fmt.Sprintf("[]%v", t.RepeatedType.ReaderTypeName())
}

func (t *goRepeatedPackedValueType) WriterTypeName() string {
	return fmt.Sprintf("[]%v", t.RepeatedType.WriterTypeName())
}

func (t *goRepeatedPackedValueType) OffsetsType() string {
	return "[]int"
}

func (t *goRepeatedPackedValueType) WireTypeType() string {
	if t.RepeatedType.CanBePacked() {
		return "[]gremlin.ProtoWireType"
	} else {
		return ""
	}
}

func (t *goRepeatedPackedValueType) CanBePacked() bool {
	return false
}

func (t *goRepeatedPackedValueType) EntrySizedReader(string, string) string {
	return ""
}

func (t *goRepeatedPackedValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	var res = fmt.Sprintf(`m.offset%v = append(m.offset%v, offset)
m.wireType%v = append(m.wireType%v, wire)`, fieldName, fieldName, fieldName, fieldName)

	return formatting.AddTabs(res, tabs)
}

func (t *goRepeatedPackedValueType) EntryReader(tabs string, localVarName string) string {
	var res = fmt.Sprintf(`
var %v %v
for i := 0; i < len(wOffset); i++ {
	wOffset := wOffset[i]
	wType := wType[i]
	if wType == gremlin.BytesType {
		size, sizeSize := m.buf.SizedReadVarInt(wOffset)
		offset := 0
		for offset < int(size) {
			wOffset := wOffset + sizeSize + offset
%v
			%v = append(%v, listEntry)
			offset += listEntrySize
		}
	} else {
%v
		%v = append(%v, listEntry)
	}
}
`, localVarName, t.ReaderTypeName(),
		t.RepeatedType.EntrySizedReader("\t\t\t", "listEntry"),
		localVarName, localVarName,
		t.RepeatedType.EntryReader("\t\t", "listEntry"),
		localVarName, localVarName)

	return formatting.AddTabs(res, tabs)
}

func (t *goRepeatedPackedValueType) ToStruct(tabs string, targetVar string, readerField string) string {
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

func (t *goRepeatedPackedValueType) EntryIsNotEmpty(localVarName string) string {
	if t.Required {
		return "true"
	}
	return fmt.Sprintf(`len(%v) > 0`, localVarName)
}

func (t *goRepeatedPackedValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = 0
if len(%v) > 1 {
	var listBytesSize = 0
	for _, entry := range %v {
		var listEntrySize = 0
%v
		listBytesSize += listEntrySize
	}
	%v += gremlin.SizeUint64(uint64(listBytesSize)) + gremlin.SizeTag(%v) + listBytesSize
} else if len(%v) == 1 {
	var listEntrySize = 0
%v
	%v += listEntrySize
}`,
		sizeVarName, fieldName,
		fieldName,
		t.RepeatedType.EntryFullSizeWithoutTag("\t\t", "listEntrySize", "entry"),
		sizeVarName, fieldTag,
		fieldName,
		t.RepeatedType.EntryFullSizeWithTag("\t", "listEntrySize", fieldName+"[0]", fieldTag),
		sizeVarName), tabs)
}

func (t *goRepeatedPackedValueType) EntryFullSizeWithoutTag(string, string, string) string {
	log.Panicf("EntryFullSizeWithoutTag should not be called on a repeated packed value type")
	return ""
}

func (t *goRepeatedPackedValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`if len(%v) > 1 {
	var listBytesSize = 0
	for _, entry := range %v {
		var entrySize = 0
%v
		listBytesSize += entrySize
	}
	%v.AppendBytesTag(%v, listBytesSize)
	for _, entry := range %v {
%v
	}
} else if len(%v) == 1 {
%v
}`, varName, varName, t.RepeatedType.EntryFullSizeWithoutTag("\t\t", "entrySize", "entry"),
		targetBuffer, tag, varName, t.RepeatedType.PackedEntryWriter("\t\t", targetBuffer, "entry"),
		varName,
		t.RepeatedType.EntryWriter("\t", targetBuffer, tag, varName+"[0]")), tabs)
}

func (t *goRepeatedPackedValueType) PackedEntryWriter(string, string, string) string {
	log.Panicf("PackedEntryWriter should not be called on a repeated value type")
	return ""
}

func (t *goRepeatedPackedValueType) DefaultReturn() string {
	return "nil"
}

func (t *goRepeatedPackedValueType) JsonStructCanBeUsedDirectly() bool {
	return t.RepeatedType.JsonStructCanBeUsedDirectly()
}

func (t *goRepeatedPackedValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	if t.RepeatedType.JsonStructCanBeUsedDirectly() {
		return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, srcVar), tabs)
	} else {
		return formatting.AddTabs(fmt.Sprintf(`%v = make(%v, len(%v))
for i := range %v {
%v
}`, targetVar, t.WriterTypeName(), srcVar, srcVar, t.RepeatedType.EntryCopy("\t", targetVar+"[i]", srcVar+"[i]")), tabs)
	}
}
