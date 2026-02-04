package types

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"strings"
)

type GoEnumType struct {
	EnumName string

	enumValuesPrefix string
	Values           []*goEnumVariant
	Proto            *types.EnumDefinition
}

type goEnumVariant struct {
	ConstName string
	Value     int
	Proto     *types.EnumValueDefinition
}

func (g *GoEnumType) GetName() string {
	return g.EnumName
}

func (g *GoEnumType) IsEnum(enumDef *types.EnumDefinition) bool {
	return g.Proto == enumDef
}

func (g *GoEnumType) IsStruct(*types.MessageDefinition) bool {
	return false
}

func (g *GoEnumType) GetEnumForDefault(value string) string {
	for _, v := range g.Values {
		if v.Proto.Name.ProtoName() == value {
			return v.ConstName
		}
	}
	return ""
}

func NewEnumType(enum *types.EnumDefinition) *GoEnumType {
	res := &GoEnumType{
		Proto: enum,
	}
	res.parseName(enum)
	res.parseValues(enum)
	return res
}

func (g *GoEnumType) parseName(enum *types.EnumDefinition) {
	var enumType = enum.Name.ProtoName()
	localPath := enum.Name.LocalPath()

	enumType = strings.ReplaceAll(enumType, ".", "_")

	if len(localPath) > 0 {
		enumType = strings.Join(localPath, "_") + "_" + enumType
		g.enumValuesPrefix = strings.Join(localPath, "_") + "_"
	} else {
		g.enumValuesPrefix = enumType + "_"
	}

	g.EnumName = enumType
}

func (g *GoEnumType) parseValues(enum *types.EnumDefinition) {
	for i, value := range enum.Values {
		valueName := g.enumValuesPrefix + value.Name.ProtoName()

		g.Values = append(g.Values, &goEnumVariant{
			ConstName: valueName,
			Value:     value.Value,
			Proto:     enum.Values[i],
		})
	}
}

func (g *GoEnumType) GenerateCode(sb *strings.Builder) {
	g.writeEnumHeader(sb)
	g.writeEnumConstants(sb)
	g.writeEnumToString(sb)
}

func (g *GoEnumType) writeEnumHeader(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
type %v int32
`, g.EnumName))
}

func (g *GoEnumType) writeEnumConstants(sb *strings.Builder) {
	sb.WriteString("\nconst (\n")
	for _, v := range g.Values {
		sb.WriteString(fmt.Sprintf("\t%v %v = %v\n", v.ConstName, g.EnumName, v.Value))
	}
	sb.WriteString(")\n")
}

func (g *GoEnumType) writeEnumToString(sb *strings.Builder) {
	sb.WriteString(fmt.Sprintf(`
func (e %v) String() string {
	switch e {
`, g.EnumName))
	var usedValues = map[int]struct{}{} // enum can contains duplicate indexes
	for _, v := range g.Values {
		if _, used := usedValues[v.Value]; !used {
			sb.WriteString(fmt.Sprintf("\tcase %v:\n\t\treturn %q\n", v.ConstName, v.Proto.Name.ProtoName()))
			usedValues[v.Value] = struct{}{}
		}
	}
	sb.WriteString(`	default:
		return ""
	}
}
`)
}
