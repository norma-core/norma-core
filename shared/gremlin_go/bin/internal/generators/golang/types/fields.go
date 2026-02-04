package types

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"strings"
)

type GoStructField struct {
	Struct *GoStructType
	Name   string
	Type   core.GoFieldType
	Proto  *types.MessageFieldDefinition
}

func (g *GoStructField) parseName(field *types.MessageFieldDefinition) {
	var name = field.Name.ProtoName()
	targetNameShouldUpper := true
	resName := ""
	for _, c := range name {
		switch c {
		case '-', '_', '.', ' ':
			targetNameShouldUpper = true
		default:
			if targetNameShouldUpper {
				resName += strings.ToUpper(string(c))
				targetNameShouldUpper = false
			} else {
				resName += string(c)
			}
		}
	}
	g.Name = resName
}

func (g *GoStructField) wireTypeConstName() string {
	return fmt.Sprintf(`wire%v_%v`, g.Struct.StructName, g.Name)
}

func (g *GoStructField) writeWireTypeConst(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf("\t%v gremlin.ProtoWireNumber = %v\n", g.wireTypeConstName(), g.Proto.ProtoDef.Sequence))
}

func (g *GoStructField) writeProtoStructData(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf("\tdata%v     %v\n", g.Name, g.Type.ReaderTypeName()))
}

func (g *GoStructField) writeProtoStructOffset(sb *strings.Builder) {
	wType := g.Type.WireTypeType()
	oType := g.Type.OffsetsType()

	var wTypeCode = ""
	if wType != "" {
		wTypeCode = fmt.Sprintf("\n\twireType%v %v", g.Name, wType)
	}

	sb.WriteString(fmt.Sprintf("\toffset%v   %v%v\n", g.Name, oType, wTypeCode))
}

func (g *GoStructField) writeProtoStructParsedFlag(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf("\tparsed%v   bool\n", g.Name))
}

func (g *GoStructField) writeAccessors(sb *strings.Builder) {
	g.writeGetter(sb)
	g.writeReader(sb)
}

func (g *GoStructField) writeGetter(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (m *%vReader) Get%v() %v {
	if m == nil {
		return %v
	}
	return m.read%v()
}
`, g.Struct.StructName, g.Name, g.Type.ReaderTypeName(), g.Type.DefaultReturn(), g.Name))
}

func (g *GoStructField) writeReader(sb *strings.Builder) {
	var wireTypeCode = ""
	if g.Type.WireTypeType() != "" {
		wireTypeCode = fmt.Sprintf("\tvar wType = m.wireType%v\n", g.Name)
	}
	sb.WriteString(fmt.Sprintf(`
func (m *%vReader) read%v() %v {
	if m.parsed%v {
		return m.data%v
	}
	wOffset := m.offset%v
%v%v
	m.data%v = entry
	m.parsed%v = true
	return entry
}
`, g.Struct.StructName, g.Name, g.Type.ReaderTypeName(), g.Name, g.Name, g.Name, wireTypeCode, g.Type.EntryReader("\t", "entry"), g.Name, g.Name))
}

func (g *GoStructField) writeUnmarshal(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
		case %v:
%v`, g.wireTypeConstName(), g.Type.EntryUnmarshalSaveOffsets("\t\t\t", g.Name)))
}

func (g *GoStructField) writeStructField(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`	%v	%v	`+"`"+`json:"%v,omitempty"`+"`"+`
`, g.Name, g.Type.WriterTypeName(), g.Proto.Name.ProtoName()))
}

func (g *GoStructField) writeToStruct(sb *strings.Builder) {
	if g.Type.JsonStructCanBeUsedDirectly() {
		sb.WriteString(fmt.Sprintf("\tres.%v = m.Get%v()\n", g.Name, g.Name))
	} else {
		sb.WriteString(fmt.Sprintf(`
	{
		var data = m.Get%v()
		var structData %v
%v
		res.%v = structData
	}
`, g.Name, g.Type.WriterTypeName(), g.Type.ToStruct("\t\t", "structData", "data"), g.Name))
	}
}

func (g *GoStructField) writeSizeCalc(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
	if %v {
		var entrySize = 0
%v
		size += entrySize
	}
`,
		g.Type.EntryIsNotEmpty("s."+g.Name),
		g.Type.EntryFullSizeWithTag("\t\t", "entrySize", "s."+g.Name, g.wireTypeConstName())))
}

func (g *GoStructField) writeMarshal(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
	if %v {
%v
	}`, g.Type.EntryIsNotEmpty("s."+g.Name), g.Type.EntryWriter("\t\t", "res", g.wireTypeConstName(), "s."+g.Name)))
}

func (g *GoStructField) writeCopy(sb *strings.Builder) {
	sb.WriteString(g.Type.EntryCopy("\t", "res."+g.Name, "s."+g.Name) + "\n")
}
