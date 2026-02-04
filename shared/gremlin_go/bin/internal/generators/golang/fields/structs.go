package fields

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"log"
)

type goStructValueType struct {
	StructPackage string
	StructName    string
	Required      bool
}

func (t *goStructValueType) ReaderTypeName() string {
	if t.StructPackage != "" {
		return "*" + t.StructPackage + "." + t.StructName + "Reader"
	}
	return "*" + t.StructName + "Reader"
}

func (t *goStructValueType) WriterTypeName() string {
	if t.StructPackage == "" {
		return "*" + t.StructName
	} else {
		return "*" + t.StructPackage + "." + t.StructName
	}
}

func (t *goStructValueType) OffsetsType() string {
	return "int"
}

func (t *goStructValueType) WireTypeType() string {
	return ""
}

func (t *goStructValueType) CanBePacked() bool {
	return false
}

func (t *goStructValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	return formatting.AddTabs(
		fmt.Sprintf(`m.offset%v = offset`, fieldName),
		tabs,
	)
}

func (t *goStructValueType) EntryReader(tabs string, localVarName string) string {
	var res string
	if t.StructPackage == "" {
		res = fmt.Sprintf(`
var %v *%vReader
if wOffset > 0 {
	var %vData = m.buf.ReadBytes(wOffset)
	if len(%vData) > 0 {
		%v = New%vReader()
		%v.Unmarshal(%vData)
	}
}
`, localVarName, t.StructName, localVarName, localVarName, localVarName, t.StructName, localVarName, localVarName)
	} else {
		res = fmt.Sprintf(`
var %v *%v.%vReader
if wOffset > 0 {
	var %vData = m.buf.ReadBytes(wOffset)
	if len(%vData) > 0 {
		%v = %v.New%vReader()
		%v.Unmarshal(%vData)
	}
}
`, localVarName, t.StructPackage, t.StructName, localVarName, localVarName, localVarName, t.StructPackage, t.StructName, localVarName, localVarName)
	}

	return formatting.AddTabs(res, tabs)
}

func (t *goStructValueType) EntrySizedReader(tabs string, localVarName string) string {
	var res string
	if t.StructPackage == "" {
		res = fmt.Sprintf(`
var %v *%vReader
var %vSize int
if wOffset > 0 {
	var %vData, %vDataSize = m.buf.SizedReadBytes(wOffset)
	if len(%vData) > 0 {
		%v = New%vReader()
		%v.Unmarshal(%vData)
	}
	%vSize = %vDataSize
}
`, localVarName, t.StructName, localVarName, localVarName, localVarName, localVarName, localVarName, t.StructName, localVarName, localVarName, localVarName, localVarName)
	} else {
		res = fmt.Sprintf(`
var %v *%v.%vReader
var %vSize int
if wOffset > 0 {
	var %vData, %vDataSize = m.buf.SizedReadBytes(wOffset)
	if len(%vData) > 0 {
		%v = %v.New%vReader()
		%v.Unmarshal(%vData)
	}
	%vSize = %vDataSize
}
`, localVarName, t.StructPackage, t.StructName, localVarName, localVarName, localVarName, localVarName, localVarName, t.StructPackage, t.StructName, localVarName, localVarName, localVarName, localVarName)
	}
	return formatting.AddTabs(res, tabs)
}

func (t *goStructValueType) ToStruct(tabs string, targetVar string, readerField string) string {
	var res = fmt.Sprintf(`if %v != nil {
	%v = %v.ToStruct()
}`, readerField, targetVar, readerField)
	return formatting.AddTabs(res, tabs)
}

func (t *goStructValueType) EntryIsNotEmpty(localVarName string) string {
	if t.Required {
		return "true"
	}
	return fmt.Sprintf(`%v != nil`, localVarName)
}

func (t *goStructValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v.XXX_PbContentSize()
%v += gremlin.SizeUint64(uint64(%v)) + gremlin.SizeTag(%v)
`, sizeVarName, fieldName, sizeVarName, sizeVarName, fieldTag), tabs)
}

func (t *goStructValueType) EntryFullSizeWithoutTag(tabs string, sizeVarName string, fieldName string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v.XXX_PbContentSize()
%v += gremlin.SizeUint64(uint64(%v))
`, sizeVarName, fieldName, sizeVarName, sizeVarName), tabs)
}

func (t *goStructValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`structSize := %v.XXX_PbContentSize()
%v.AppendBytesTag(%v, structSize)
%v.MarshalTo(%v)`, varName, targetBuffer, tag, varName, targetBuffer), tabs)
}

func (t *goStructValueType) PackedEntryWriter(string, string, string) string {
	log.Panicf("PackedEntryWriter should not be called on a struct value type")
	return ""
}

func (t *goStructValueType) DefaultReturn() string {
	return "nil"
}

func (t *goStructValueType) JsonStructCanBeUsedDirectly() bool {
	return false
}

func (t *goStructValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	return formatting.AddTabs(fmt.Sprintf(`if %v != nil {
	%v = %v.Copy()
}`, srcVar, targetVar, srcVar), tabs)
}
