package fields

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/formatting"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
)

var goBasicTypesMap = map[string]string{
	"string":   "string",
	"bytes":    "[]byte",
	"bool":     "bool",
	"double":   "float64",
	"float":    "float32",
	"int32":    "int32",
	"int64":    "int64",
	"uint32":   "uint32",
	"uint64":   "uint64",
	"sint32":   "int32",
	"sint64":   "int64",
	"fixed32":  "uint32",
	"fixed64":  "uint64",
	"sfixed32": "int32",
	"sfixed64": "int64",
}

type goBasicValueType struct {
	Name         string
	ProtoType    string
	DefaultValue string
	Required     bool
}

func (t *goBasicValueType) ReaderTypeName() string {
	return t.Name
}

func (t *goBasicValueType) WriterTypeName() string {
	return t.Name
}

func (t *goBasicValueType) parseDefaultValue(file GoEntitiesProvider, field *types.MessageFieldDefinition) error {
	if field.DefaultValue == nil {
		return nil
	}

	switch t.Name {
	case "[]byte":
		t.parseByteDefaultValue(file, field)
	case "string":
		t.DefaultValue = fmt.Sprintf("%q", field.DefaultValue.Constant.Source)
	default:
		switch field.DefaultValue.Constant.Source {
		case "inf":
			t.setPositiveInfDefault(file)
		case "-inf":
			t.setNegativeInfDefault(file)
		case "nan":
			t.setNanDefault(file)
		default:
			t.DefaultValue = field.DefaultValue.Constant.Source
		}
	}

	return nil
}

func (t *goBasicValueType) parseByteDefaultValue(file GoEntitiesProvider, field *types.MessageFieldDefinition) {
	file.AddImport("bytes", "bytes")
	if field.DefaultValue.Constant.IsString {
		t.DefaultValue = fmt.Sprintf("[]byte(%q)", field.DefaultValue.Constant.Source)
	} else {
		t.DefaultValue = fmt.Sprintf("[]byte(%v)", field.DefaultValue.Constant.Source)
	}
}

func (t *goBasicValueType) setPositiveInfDefault(file GoEntitiesProvider) {
	file.AddImport("math", "math")
	if t.Name != "float64" {
		t.DefaultValue = fmt.Sprintf("%v(math.Inf(1))", t.Name)
	} else {
		t.DefaultValue = "math.Inf(1)"
	}
}

func (t *goBasicValueType) setNegativeInfDefault(file GoEntitiesProvider) {
	file.AddImport("math", "math")
	if t.Name != "float64" {
		t.DefaultValue = fmt.Sprintf("%v(math.Inf(-1))", t.Name)
	} else {
		t.DefaultValue = "math.Inf(-1)"
	}
}

func (t *goBasicValueType) setNanDefault(file GoEntitiesProvider) {
	file.AddImport("math", "math")
	if t.Name != "float64" {
		t.DefaultValue = fmt.Sprintf("%v(math.NaN())", t.Name)
	} else {
		t.DefaultValue = "math.NaN()"
	}
}

func (t *goBasicValueType) OffsetsType() string {
	return "int"
}

func (t *goBasicValueType) WireTypeType() string {
	return ""
}

var canBePacked = map[string]bool{
	"bool":     true,
	"double":   true,
	"float":    true,
	"int32":    true,
	"int64":    true,
	"uint32":   true,
	"uint64":   true,
	"sint32":   true,
	"sint64":   true,
	"fixed32":  true,
	"fixed64":  true,
	"sfixed32": true,
	"sfixed64": true,
}

func (t *goBasicValueType) CanBePacked() bool {
	return canBePacked[t.ProtoType]
}

var bufBasicTypesReaders = map[string]string{
	"string":   "ReadString",
	"bytes":    "ReadBytes",
	"bool":     "ReadBool",
	"double":   "ReadFloat64",
	"float":    "ReadFloat32",
	"int32":    "ReadInt32",
	"int64":    "ReadInt64",
	"uint32":   "ReadUint32",
	"uint64":   "ReadUint64",
	"sint32":   "ReadSInt32",
	"sint64":   "ReadSInt64",
	"fixed32":  "ReadFixed32",
	"fixed64":  "ReadFixed64",
	"sfixed32": "ReadSFixed32",
	"sfixed64": "ReadSFixed64",
}

func (t *goBasicValueType) EntryUnmarshalSaveOffsets(tabs string, fieldName string) string {
	return formatting.AddTabs(
		fmt.Sprintf(`m.offset%v = offset`, fieldName),
		tabs,
	)
}

func (t *goBasicValueType) EntryReader(tabs string, localVarName string) string {
	var res string
	if t.DefaultValue == "" {
		res = fmt.Sprintf(`
var %v %v
if wOffset > 0 {
	%v = m.buf.%v(wOffset)
}
`, localVarName, t.ReaderTypeName(), localVarName, bufBasicTypesReaders[t.ProtoType])
	} else {
		res = fmt.Sprintf(`
var %v %v
if wOffset > 0 {
	%v = m.buf.%v(wOffset)
} else {
	%v = %v
}
`, localVarName, t.ReaderTypeName(), localVarName, bufBasicTypesReaders[t.ProtoType], localVarName, t.DefaultValue)
	}

	return formatting.AddTabs(res, tabs)
}

func (t *goBasicValueType) EntrySizedReader(tabs string, localVarName string) string {
	var res string
	if t.DefaultValue == "" {
		res = fmt.Sprintf(`
var %v %v
var %vSize int
if wOffset > 0 {
	%v, %vSize = m.buf.Sized%v(wOffset)
}
`, localVarName, t.ReaderTypeName(), localVarName, localVarName, localVarName, bufBasicTypesReaders[t.ProtoType])
	} else {
		res = fmt.Sprintf(`
var %v %v
var %vSize int
if wOffset > 0 {
	%v, %vSize = m.buf.Sized%v(wOffset)
} else {
	%v = %v
}
`, localVarName, t.ReaderTypeName(), localVarName, localVarName, localVarName, bufBasicTypesReaders[t.ProtoType], localVarName, t.DefaultValue)
	}

	return formatting.AddTabs(res, tabs)
}

func (t *goBasicValueType) ToStruct(tabs string, targetVar string, readerField string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, readerField), tabs)
}

func (t *goBasicValueType) EntryIsNotEmpty(localVarName string) string {
	if t.Required {
		return "true"
	}
	switch t.ReaderTypeName() {
	case "[]byte":
		if t.DefaultValue == "" {
			return fmt.Sprintf(`len(%v) != 0`, localVarName)
		} else {
			return fmt.Sprintf(`!bytes.Equal(%v, %v)`, localVarName, t.DefaultValue)
		}
	case "string":
		if t.DefaultValue == "" {
			return fmt.Sprintf(`%v != ""`, localVarName)
		} else {
			return fmt.Sprintf(`%v != %v`, localVarName, t.DefaultValue)
		}
	case "bool":
		if t.DefaultValue == "" {
			return fmt.Sprintf(`%v`, localVarName)
		} else {
			return fmt.Sprintf(`%v != %v`, localVarName, t.DefaultValue)
		}
	default:
		if t.DefaultValue == "" {
			return fmt.Sprintf(`%v != 0`, localVarName)
		} else {
			return fmt.Sprintf(`%v != %v`, localVarName, t.DefaultValue)
		}
	}
}

func (t *goBasicValueType) DefaultReturn() string {
	if t.DefaultValue != "" {
		return t.DefaultValue
	}
	switch t.ReaderTypeName() {
	case "[]byte":
		return "nil"
	case "string":
		return `""`
	case "bool":
		return "false"
	default:
		return "0"
	}
}

var bufBasicTypesWriters = map[string]string{
	"string":   "AppendString",
	"bytes":    "AppendBytes",
	"bool":     "AppendBool",
	"double":   "AppendFloat64",
	"float":    "AppendFloat32",
	"int32":    "AppendInt32",
	"int64":    "AppendInt64",
	"uint32":   "AppendUint32",
	"uint64":   "AppendUint64",
	"sint32":   "AppendSInt32",
	"sint64":   "AppendSInt64",
	"fixed32":  "AppendFixed32",
	"fixed64":  "AppendFixed64",
	"sfixed32": "AppendSFixed32",
	"sfixed64": "AppendSFixed64",
}

func (t *goBasicValueType) EntryWriter(tabs string, targetBuffer string, tag string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf("%v.%v(%v, %v)", targetBuffer, bufBasicTypesWriters[t.ProtoType], tag, varName), tabs)
}

func (t *goBasicValueType) PackedEntryWriter(tabs string, targetBuffer string, varName string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v.%vWithoutTag(%v)`, targetBuffer, bufBasicTypesWriters[t.ProtoType], varName), tabs)
}

func (t *goBasicValueType) JsonStructCanBeUsedDirectly() bool {
	return true
}

func (t *goBasicValueType) EntryCopy(tabs string, targetVar string, srcVar string) string {
	return formatting.AddTabs(fmt.Sprintf(`%v = %v`, targetVar, srcVar), tabs)
}

var bufBasicTypesSizers = map[string]string{
	"string":   "SizeString",
	"bytes":    "SizeBytes",
	"bool":     "SizeBool",
	"double":   "SizeFloat64",
	"float":    "SizeFloat32",
	"int32":    "SizeInt32",
	"int64":    "SizeInt64",
	"uint32":   "SizeUint32",
	"uint64":   "SizeUint64",
	"sint32":   "SizeSInt32",
	"sint64":   "SizeSInt64",
	"fixed32":  "SizeFixed32",
	"fixed64":  "SizeFixed64",
	"sfixed32": "SizeSFixed32",
	"sfixed64": "SizeSFixed64",
}

func (t *goBasicValueType) EntryFullSizeWithTag(tabs string, sizeVarName string, fieldName string, fieldTag string) string {
	if t.ProtoType == "bytes" || t.ProtoType == "string" {
		return formatting.AddTabs(fmt.Sprintf(`%v = gremlin.%v(%v)
%v += gremlin.SizeUint64(uint64(%v)) + gremlin.SizeTag(%v)`, sizeVarName, bufBasicTypesSizers[t.ProtoType], fieldName, sizeVarName, sizeVarName, fieldTag), tabs)
	} else {
		return formatting.AddTabs(fmt.Sprintf(
			"%v = gremlin.SizeTag(%v) + gremlin.%v(%v)", sizeVarName, fieldTag, bufBasicTypesSizers[t.ProtoType], fieldName),
			tabs)
	}
}

func (t *goBasicValueType) EntryFullSizeWithoutTag(tabs string, sizeVarName string, fieldName string) string {
	if t.ProtoType == "bytes" || t.ProtoType == "string" {
		return formatting.AddTabs(fmt.Sprintf(`%v = gremlin.%v(%v)
%v += gremlin.SizeUint64(uint64(%v))`, sizeVarName, bufBasicTypesSizers[t.ProtoType], fieldName, sizeVarName, sizeVarName), tabs)
	} else {
		return formatting.AddTabs(fmt.Sprintf(
			"%v = gremlin.%v(%v)", sizeVarName, bufBasicTypesSizers[t.ProtoType], fieldName),
			tabs)
	}
}
