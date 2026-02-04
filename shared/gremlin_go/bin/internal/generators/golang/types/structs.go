package types

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/generators/golang/core"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"strings"
)

type GoStructType struct {
	StructName string
	Proto      *types.MessageDefinition

	Fields []*GoStructField
}

func (g *GoStructType) GetName() string {
	return g.StructName
}

func (g *GoStructType) IsEnum(*types.EnumDefinition) bool {
	return false
}

func (g *GoStructType) IsStruct(structDef *types.MessageDefinition) bool {
	return g.Proto == structDef
}

func (g *GoStructType) GetEnumForDefault(string) string {
	return ""
}

func NewStructType(structDef *types.MessageDefinition) *GoStructType {
	res := &GoStructType{
		Proto: structDef,
	}
	res.parseName(structDef)
	return res
}

func (g *GoStructType) parseName(msg *types.MessageDefinition) {
	var msgType = msg.Name.ProtoName()
	if len(msg.Name.LocalPath()) > 0 {
		msgType = strings.Join(msg.Name.LocalPath(), "_") + "_" + msgType
	}
	msgType = strings.ReplaceAll(msgType, ".", "_")

	g.StructName = msgType
}

func (g *GoStructType) AddField(fieldDef *types.MessageFieldDefinition, fieldType core.GoFieldType) {
	field := &GoStructField{
		Proto:  fieldDef,
		Type:   fieldType,
		Struct: g,
	}
	field.parseName(fieldDef)

	g.Fields = append(g.Fields, field)
}

func (g *GoStructType) GenerateCode(sb *strings.Builder) {
	g.writeWireTypes(sb)
	// reader
	g.writeReaderStruct(sb)
	g.writeReaderConstructor(sb)
	g.writeFieldsAccessors(sb)
	g.writeUnmarshal(sb)
	g.writeToStruct(sb)
	g.writeGetBytes(sb)

	// writer
	g.writeStruct(sb)
	g.writeMarshal(sb)
	g.writeCopy(sb)
	g.writeSize(sb)
}

func (g *GoStructType) writeWireTypes(sb *strings.Builder) {
	sb.WriteString("\nconst (\n")
	for _, field := range g.Fields {
		field.writeWireTypeConst(sb)
	}
	sb.WriteString(")\n")
}

func (g *GoStructType) writeReaderConstructor(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func New%vReader() *%vReader {
	return &%vReader{}
}
`, g.StructName, g.StructName, g.StructName))
}

func (g *GoStructType) writeReaderStruct(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
type %vReader struct {
	buf *gremlin.Reader

`, g.StructName))

	for _, field := range g.Fields {
		field.writeProtoStructData(sb)
	}

	sb.WriteByte('\n')

	for _, field := range g.Fields {
		field.writeProtoStructOffset(sb)
	}

	sb.WriteByte('\n')

	for _, field := range g.Fields {
		field.writeProtoStructParsedFlag(sb)
	}

	sb.WriteString("}\n")
}

func (g *GoStructType) writeStruct(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
type %v struct {
`, g.StructName))
	for _, field := range g.Fields {
		field.writeStructField(sb)
	}
	sb.WriteString("}\n")
}

func (g *GoStructType) writeFieldsAccessors(sb *strings.Builder) {
	for _, field := range g.Fields {
		field.writeAccessors(sb)
	}
}

func (g *GoStructType) writeUnmarshal(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (m *%vReader) Unmarshal(data []byte) error {
	m.buf = gremlin.NewReader(data)
	offset := 0
	for m.buf.HasNext(offset, 0) {
		tag, wire, tagSize, err := m.buf.ReadTagAt(offset)
		if err != nil {
			return err
		}

		offset += tagSize
		switch tag {`, g.StructName))
	for _, field := range g.Fields {
		field.writeUnmarshal(sb)
	}
	sb.WriteString(`
		}

		offset, err = m.buf.SkipData(offset, wire)
		if err != nil {
			return err
		}
	}
	return nil
}
`)
}

func (g *GoStructType) writeToStruct(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (m *%vReader) ToStruct() *%v {
	if m == nil {
		return nil
	}
	res := &%v{}
`, g.StructName, g.StructName, g.StructName))
	for _, field := range g.Fields {
		field.writeToStruct(sb)
	}
	sb.WriteString(`
	return res
}
`)
}

func (g *GoStructType) writeMarshal(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (s *%v) Marshal() []byte {
	if s == nil {
		return nil
	}
	size := s.XXX_PbContentSize()
	if size == 0 {
		return nil
	}
	res := gremlin.NewWriter(size)
	s.MarshalTo(res)
	return res.Bytes()
}

func (s *%v) MarshalTo(res *gremlin.Writer) {
	if s == nil {
		return
	}
`, g.StructName, g.StructName))

	for _, field := range g.Fields {
		field.writeMarshal(sb)
	}
	sb.WriteString(`
}
`)
}

func (g *GoStructType) writeSize(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (s *%v) XXX_PbContentSize() int {
	if s == nil {
		return 0
	}
	var size = 0
`, g.StructName))

	for _, field := range g.Fields {
		field.writeSizeCalc(sb)
	}
	sb.WriteString(`
	return size
}
`)
}

func (g *GoStructType) writeGetBytes(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (s *%vReader) SourceBytes() []byte {
	if s == nil {
		return nil
	}
	return s.buf.Bytes()
}
`, g.StructName))
}

func (g *GoStructType) writeCopy(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (s *%v) Copy() *%v {
	if s == nil {
		return nil
	}
	res := &%v{}
`, g.StructName, g.StructName, g.StructName))
	for _, field := range g.Fields {
		field.writeCopy(sb)
	}
	sb.WriteString(`
	return res
}
`)
}
