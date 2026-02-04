package fields

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"log"
)

const (
	mapEntryKeyTag   = 1
	mapEntryValueTag = 2
)

type goMapValueType struct {
	KeyType   core.GoFieldType
	ValueType core.GoFieldType
}

func (t *goMapValueType) ReaderTypeName() string {
	return fmt.Sprintf("map[%v]%v", t.KeyType.ReaderTypeName(), t.ValueType.ReaderTypeName())
}

func (t *goMapValueType) WriterTypeName() string {
	return fmt.Sprintf("map[%v]%v", t.KeyType.WriterTypeName(), t.ValueType.WriterTypeName())
}

func (t *goMapValueType) OffsetsType() string {
	return "[]int"
}

func (t *goMapValueType) WireTypeType() string {
	return ""
}

func (t *goMapValueType) CanBePacked() bool {
	return false
}

func (t *goMapValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	return formatting.AddTabs(
		fmt.Sprintf(`m.offset%v = append(m.offset%v, offset)`, fieldName, fieldName),
		tabs,
	)
}

func (t *goMapValueType) EntryReader(tabs string, localVarName string) string {
	res := fmt.Sprintf(`
var %v = map[%v]%v{}
for i := range wOffset {
	wOffset := wOffset[i]

	entrySize, entrySizeSize := m.buf.SizedReadVarInt(wOffset)
	endOffset := wOffset + entrySizeSize + int(entrySize)
	wOffset += entrySizeSize
	
	var keyData %v
	var valueData %v
	for wOffset < endOffset {
		tag, wireType, tagSize, _ := m.buf.ReadTagAt(wOffset)
		wOffset += tagSize
		if tag == 1 {
%v
			wOffset += keyEntrySize
			keyData = keyEntry
		} else if tag == 2 {
%v
			wOffset += valueEntrySize
			valueData = valueEntry
		} else {
			wOffset, _ = m.buf.SkipData(wOffset, wireType)
		}
	}
	%v[keyData] = valueData
}
`, localVarName, t.KeyType.ReaderTypeName(), t.ValueType.ReaderTypeName(),
		t.KeyType.ReaderTypeName(), t.ValueType.ReaderTypeName(),
		t.KeyType.EntrySizedReader("\t\t\t", "keyEntry"),
		t.ValueType.EntrySizedReader("\t\t\t", "valueEntry"),
		localVarName)

	return formatting.AddTabs(res, tabs)
}

func (t *goMapValueType) EntrySizedReader(string, string) string {
	return ""
}

func (t *goMapValueType) ToStruct(tabs string, targetVar string, readerField string) string {
	res := fmt.Sprintf(`if len(%v) > 0 {
	%v = make(%v, len(%v))
	for k,v := range %v {
%v
	}
}`,
		readerField, targetVar, t.WriterTypeName(), readerField,
		readerField,
		t.ValueType.ToStruct("\t\t", targetVar+"[k]", "v"),
	)
	return formatting.AddTabs(res, tabs)
}

func (t *goMapValueType) EntryIsNotEmpty(localVarName string) string {
	return fmt.Sprintf(`len(%v) > 0`, localVarName)
}

func (t *goMapValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = 0
for k, v := range %v {
	var keySize, valueSize int
%v
%v
	var mapEntrySize = keySize + valueSize
	%v += mapEntrySize + gremlin.SizeTag(%v) + gremlin.SizeUint64(uint64(mapEntrySize))
}
`,
		sizeVarName, fieldName,
		t.KeyType.EntryFullSizeWithTag("\t", "keySize", "k", fmt.Sprintf("%d", mapEntryKeyTag)),
		t.ValueType.EntryFullSizeWithTag("\t", "valueSize", "v", fmt.Sprintf("%d", mapEntryValueTag)),
		sizeVarName, fieldTag,
	), tabs)
}

func (t *goMapValueType) EntryFullSizeWithoutTag(string, string, string) string {
	log.Panicf("EntryFullSizeWithoutTag should not be called on a map value type")
	return ""
}

func (t *goMapValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`for k, v := range %v {
	var keySize, valueSize int
%v
%v
	mapEntrySize := keySize + valueSize
	%v.AppendBytesTag(%v, mapEntrySize)
%v
%v
}`,
		varName,
		t.KeyType.EntryFullSizeWithTag("\t", "keySize", "k", fmt.Sprintf("%d", mapEntryKeyTag)),
		t.ValueType.EntryFullSizeWithTag("\t", "valueSize", "v", fmt.Sprintf("%d", mapEntryValueTag)),
		targetBuffer, tag,
		t.KeyType.EntryWriter("\t", targetBuffer, fmt.Sprintf("%d", mapEntryKeyTag), "k"),
		t.ValueType.EntryWriter("\t", targetBuffer, fmt.Sprintf("%d", mapEntryValueTag), "v"),
	), tabs)
}

func (t *goMapValueType) PackedEntryWriter(string, string, string) string {
	log.Panicf("PackedEntryWriter should not be called on a map value type")
	return ""
}

func (t *goMapValueType) DefaultReturn() string {
	return "nil"
}

func (t *goMapValueType) JsonStructCanBeUsedDirectly() bool {
	return t.KeyType.JsonStructCanBeUsedDirectly() && t.ValueType.JsonStructCanBeUsedDirectly()
}

func (t *goMapValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = make(map[%v]%v, len(%v))
for k, v := range %v {
%v
}`, targetVar, t.KeyType.WriterTypeName(), t.ValueType.WriterTypeName(), srcVar, srcVar, t.ValueType.EntryCopy("\t", targetVar+"[k]", "v")), tabs)
}
