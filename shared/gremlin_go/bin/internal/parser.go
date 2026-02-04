package internal

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"sync"

	"github.com/emicklei/proto"
)

func ParseStruct(targets []*types.ProtoFile) []error {
	var wg = sync.WaitGroup{}
	wg.Add(len(targets))
	var errors []error
	var errorsLock = sync.Mutex{}

	for i := range targets {
		go func(i int) {
			extractProtoStruct(targets[i], &errors, &errorsLock)
			wg.Done()
		}(i)
	}
	wg.Wait()

	return errors
}

func extractProtoStruct(file *types.ProtoFile, errors *[]error, lock *sync.Mutex) {
	proto.Walk(file.Parsed, walkHandler(file, errors, lock))
}

func walkHandler(pFile *types.ProtoFile, errors *[]error, lock *sync.Mutex) proto.Handler {
	return func(v proto.Visitee) {
		if i, ok := v.(*proto.Import); ok {
			if i.Filename == "google/protobuf/descriptor.proto" {
				return
			}
			pFile.Imports = append(pFile.Imports, &types.ProtoImport{
				FSPath:   i.Filename,
				ProtoDef: i,
			})
			return
		}

		if i, ok := v.(*proto.Syntax); ok {
			if i.Value == "proto2" {
				pFile.Proto2 = true
			}
			return
		}

		if p, ok := v.(*proto.Package); ok {
			if pFile.Package == nil {
				pFile.Package = &types.ProtoPackage{
					Name:     types.ParseName(p.Name),
					ProtoDef: p,
				}
			} else {
				pFile.Package.Name = types.ParseName(p.Name)
				pFile.Package.ProtoDef = p
			}
			return
		}

		if o, ok := v.(*proto.Option); ok {
			if o.Name == "go_package" {
				if pFile.Package == nil {
					pFile.Package = &types.ProtoPackage{}
				}
				pFile.Package.Name = pFile.Package.Name.
					WithPlatformName(types.TargetPlatform_Go, o.Constant.Source)
			}
			return
		}

		if m, ok := v.(*proto.Message); ok {
			msg := extractMessage(pFile, m, errors, lock)
			pFile.Messages = append(pFile.Messages, msg)
			return
		}

		if e, ok := v.(*proto.Enum); ok {
			pFile.Enums = append(pFile.Enums, extractEnum(pFile, e))
			return
		}
	}
}

func buildScopedName(pFile *types.ProtoFile, e proto.Visitee, name string) types.ScopedName {
	var parent proto.Visitee
	if _, isMsg := e.(*proto.Message); isMsg {
		parent = e.(*proto.Message).Parent
	} else if _, isEnum := e.(*proto.Enum); isEnum {
		parent = e.(*proto.Enum).Parent
	}

	if p, ok := parent.(*proto.Message); ok {
		parentScoped := buildScopedName(pFile, p, p.Name)
		return parentScoped.LocalChild(name)
	} else {
		if pFile.Package == nil {
			return types.ParseName(name)
		}
		return pFile.Package.Name.Child(name)
	}
}

func extractEnum(pFile *types.ProtoFile, e *proto.Enum) *types.EnumDefinition {
	res := &types.EnumDefinition{
		Name:     buildScopedName(pFile, e, e.Name),
		ProtoDef: e,
	}

	for _, element := range e.Elements {
		if v, ok := element.(*proto.EnumField); ok {
			def := &types.EnumValueDefinition{
				Name:     res.Name.Child(v.Name),
				Value:    v.Integer,
				ProtoDef: v,
			}
			res.Values = append(res.Values, def)
		}
	}

	return res
}

func extractMessage(pFile *types.ProtoFile, e *proto.Message, errors *[]error, lock *sync.Mutex) *types.MessageDefinition {
	res := &types.MessageDefinition{
		Name:     buildScopedName(pFile, e, e.Name),
		ProtoDef: e,
	}

	for _, element := range e.Elements {
		if g, ok := element.(*proto.Group); ok {
			lock.Lock()
			*errors = append(*errors, fmt.Errorf("groups are deprecated and not supported by this parser (file: %s, group: %v)", pFile.Path, g.Name))
			lock.Unlock()
			continue
		}

		fields := parseStructElement(res.Name, element)
		if fields != nil {
			res.Fields = append(res.Fields, fields...)
		}
	}

	return res
}

func parseStructElement(name types.ScopedName, element proto.Visitee) []*types.MessageFieldDefinition {
	var target any = element
	if v, ok := element.(*proto.OneOfField); ok {
		target = v.Field
	}

	if normalField, isNormal := target.(*proto.NormalField); isNormal {
		return []*types.MessageFieldDefinition{extractField(name, normalField)}
	} else if mapField, isMap := target.(*proto.MapField); isMap {
		return []*types.MessageFieldDefinition{extractMap(name, mapField)}
	} else if oneof, isOneOf := target.(*proto.Oneof); isOneOf {
		return extractOneOf(name, oneof)
	} else if basic, isBasic := target.(*proto.Field); isBasic {
		return []*types.MessageFieldDefinition{extractBasicField(name, basic)}
	}
	return nil
}

func extractField(name types.ScopedName, v *proto.NormalField) *types.MessageFieldDefinition {
	res := &types.MessageFieldDefinition{
		Name:         name.Child(v.Name),
		ProtoDef:     v.Field,
		Repeated:     v.Repeated,
		DefaultValue: extractDefaultValue(v.Field),
		Required:     v.Required,
	}

	if _, isScalar := types.ProtobufScalarTypes[v.Type]; isScalar {
		res.ScalarValueType = v.Type
	}

	return res
}

func extractBasicField(name types.ScopedName, v *proto.Field) *types.MessageFieldDefinition {
	res := &types.MessageFieldDefinition{
		Name:         name.Child(v.Name),
		ProtoDef:     v,
		DefaultValue: extractDefaultValue(v),
	}

	if _, isScalar := types.ProtobufScalarTypes[v.Type]; isScalar {
		res.ScalarValueType = v.Type
	}

	return res
}

func extractMap(name types.ScopedName, field *proto.MapField) *types.MessageFieldDefinition {
	res := &types.MessageFieldDefinition{
		Name:     name.Child(field.Name),
		ProtoDef: field.Field,
		Map:      true,
	}

	if _, isScalar := types.ProtobufScalarTypes[field.KeyType]; isScalar {
		// we can add enums support here
		res.MapKeyType = field.KeyType
	}

	if _, isScalar := types.ProtobufScalarTypes[field.Type]; isScalar {
		res.ScalarValueType = field.Type
	}

	return res
}

func extractOneOf(name types.ScopedName, oneof *proto.Oneof) []*types.MessageFieldDefinition {
	group := oneof.Name
	var res []*types.MessageFieldDefinition
	for _, element := range oneof.Elements {
		fields := parseStructElement(name, element)
		for _, field := range fields {
			field.OneOfGroup = group
		}
		res = append(res, fields...)
	}
	return res
}

func extractDefaultValue(field *proto.Field) *proto.Option {
	for _, option := range field.Options {
		if option.Name == "default" {
			return option
		}
	}
	return nil
}
