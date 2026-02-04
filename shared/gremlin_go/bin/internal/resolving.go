package internal

import (
	"fmt"
	"github.com/norma-core/norma-core/shared/gremlin_go/bin/internal/types"
	"strings"

	"github.com/emicklei/proto"
)

func resolveExtensions(pFile *types.ProtoFile) []error {
	var errors []error

	var removed []*types.MessageDefinition
	for i := range pFile.Messages {
		message := pFile.Messages[i]
		if message.ProtoDef.IsExtend {
			localSrc := resolveLocalExtendSource(pFile, message)
			if localSrc != nil {
				if localSrc.Name.Equal(message.Name) {
					removed = append(removed, localSrc)
				}
				for _, field := range localSrc.Fields {
					field := field.Copy()
					field.ExtraScopes = append(field.ExtraScopes, localSrc.Name)
					message.Fields = append(message.Fields, field)
				}
			} else {
				externalSrc := resolveImportedExtendSource(pFile, message)
				if externalSrc != nil {
					for _, field := range externalSrc.Fields {
						field := field.Copy()
						field.ExtraScopes = append(field.ExtraScopes, externalSrc.Name)
						message.Fields = append(message.Fields, field)
					}
				} else if !strings.HasPrefix(message.ProtoDef.Name, "google.protobuf.") {
					errors = append(errors,
						fmt.Errorf("failed to resolve extend source %v in %v (%v)",
							message.ProtoDef.Name,
							message.Name.String(),
							pFile.RelativePath,
						))
				}
			}
		}
	}

	// remove extended messages which are overridden by extensions
	if len(removed) > 0 {
		var filteredMessages []*types.MessageDefinition
		for _, msg := range pFile.Messages {
			isRemoved := false
			for _, removedMsg := range removed {
				if msg == removedMsg {
					isRemoved = true
					break
				}
			}

			if !isRemoved {
				filteredMessages = append(filteredMessages, msg)
			}
		}

		pFile.Messages = filteredMessages
	}

	return errors
}

func resolveReferences(pFile *types.ProtoFile) []error {
	var errors []error

	for i := range pFile.Messages {
		message := pFile.Messages[i]
		for j := range message.Fields {
			field := message.Fields[j]
			if field.ScalarValueType != "" {
				continue
			}

			if resolveLocalReference(pFile, message, field) {
				continue
			}

			if resolveImportedReference(pFile, field) {
				continue
			}

			errors = append(errors,
				fmt.Errorf("failed to resolve reference %v in %v (%v)",
					field.ProtoDef.Type,
					message.Name.String(),
					pFile.RelativePath,
				))
		}
	}

	return errors
}

func resolveLocalExtendSource(pFile *types.ProtoFile, m *types.MessageDefinition) *types.MessageDefinition {
	scopedName := types.ParseName(m.ProtoDef.Name)
	searchPath := m.Name
	search := true
	for search {
		name := scopedName.ToScope(searchPath)

		for i := range pFile.Messages {
			msg := pFile.Messages[i]
			if msg.Name.Equal(name) && !msg.ProtoDef.IsExtend {
				return msg
			}
		}
		search = searchPath.CanResolveParent()
		searchPath = searchPath.ToParent()
	}

	return nil
}

func resolveImportedExtendSource(file *types.ProtoFile, m *types.MessageDefinition) *types.MessageDefinition {
	scopedName := types.ParseName(m.ProtoDef.Name)

	for _, protoImport := range file.Imports {
		var searchPath types.ScopedName
		if protoImport.TargetFile == nil {
			continue
		}

		if protoImport.TargetFile.Package != nil {
			searchPath = protoImport.TargetFile.Package.Name
		}

		var search = true
		for search {
			name := scopedName.ToScope(searchPath)

			for i := range protoImport.TargetFile.Messages {
				msg := protoImport.TargetFile.Messages[i]
				if msg.Name.Equal(name) && !msg.ProtoDef.IsExtend {
					return msg
				}
			}
			search = searchPath.CanResolveParent()
			searchPath = searchPath.ToParent()
		}
	}
	return nil
}

func resolveLocalReference(file *types.ProtoFile, m *types.MessageDefinition, field *types.MessageFieldDefinition) bool {
	typeName := field.ProtoDef.Type
	scopesToSearch := []types.ScopedName{types.ParseName(typeName)}
	scopesToSearch = append(scopesToSearch, field.ExtraScopes...)

	for _, scopedName := range scopesToSearch {
		searchPath := m.Name
		search := true
		for search {
			name := scopedName.ToScope(searchPath)

			for _, enum := range file.Enums {
				if enum.Name.Equal(name) {
					field.LocalEnumType = enum
					return true
				}
			}
			for _, msg := range file.Messages {
				if msg.Name.Equal(name) {
					field.LocalMsgType = msg
					return true
				}
			}
			search = searchPath.CanResolveParent()
			searchPath = searchPath.ToParent()
		}
	}

	return false
}

func resolveImportedReference(file *types.ProtoFile, field *types.MessageFieldDefinition) bool {
	// imported can be used only by part of package name, or by full package name
	typeName := field.ProtoDef.Type
	scopesToSearch := []types.ScopedName{types.ParseName(typeName)}
	scopesToSearch = append(scopesToSearch, field.ExtraScopes...)

	for _, scopedName := range scopesToSearch {
		for _, protoImport := range file.Imports {
			var searchPath types.ScopedName
			if protoImport.TargetFile == nil {
				continue
			}

			if protoImport.TargetFile.Package != nil {
				searchPath = protoImport.TargetFile.Package.Name
			}

			var search = true
			for search {
				name := scopedName.ToScope(searchPath)

				for _, enum := range protoImport.TargetFile.Enums {
					if enum.Name.Equal(name) {
						field.ExternalEnumType = enum
						field.ExternalTypeFile = protoImport.TargetFile
						return true
					}
				}
				for _, msg := range protoImport.TargetFile.Messages {
					if msg.Name.Equal(name) {
						field.ExternalMsgType = msg
						field.ExternalTypeFile = protoImport.TargetFile
						return true
					}
				}
				search = searchPath.CanResolveParent()
				searchPath = searchPath.ToParent()
			}
		}
	}
	return false
}

func resolveOptions(file *types.ProtoFile) []error {
	var extraOptions = map[string]*types.MessageFieldDefinition{}
	var errors []error

	for _, message := range file.Messages {
		if message.Name.ProtoName() == "google.protobuf.EnumValueOptions" {
			for _, field := range message.Fields {
				field := field
				extraOptions[field.Name.ProtoName()] = field
			}
		}
	}

	for _, enum := range file.Enums {
		for _, value := range enum.Values {
			for _, element := range value.ProtoDef.Elements {
				opt, isOpt := element.(*proto.Option)
				if !isOpt {
					continue
				}

				field, ok := extraOptions[opt.Name]
				if !ok {
					cleanedName := strings.TrimPrefix(opt.Name, "(")
					cleanedName = strings.TrimSuffix(cleanedName, ")")
					field, ok = extraOptions[cleanedName]
				}

				if !ok {
					errors = append(errors,
						fmt.Errorf("unknown option %s for enum value %s", opt.Name, value.Name))
				}

				if value.Options == nil {
					value.Options = map[string]*types.EnumValueOptionDefinition{}
				}

				var optValue string
				if opt.Constant.IsString && field.ScalarValueType != "" {
					optValue = fmt.Sprintf("%q", opt.Constant.Source)
				} else {
					optValue = opt.Constant.Source
				}

				if field.Repeated {
					if value.Options[field.Name.ProtoName()] == nil {
						value.Options[field.Name.ProtoName()] = &types.EnumValueOptionDefinition{
							Name:            field.Name.ProtoName(),
							Repeated:        field.Repeated,
							ScalarValueType: field.ScalarValueType,
							LocalEnumType:   field.LocalEnumType,

							Values: []string{},
						}
					}
					value.Options[field.Name.ProtoName()].Values = append(value.Options[field.Name.ProtoName()].Values, optValue)
				} else {
					value.Options[field.Name.ProtoName()] = &types.EnumValueOptionDefinition{
						Name:            field.Name.ProtoName(),
						Repeated:        field.Repeated,
						ScalarValueType: field.ScalarValueType,
						LocalEnumType:   field.LocalEnumType,
						ProtoDef:        opt,
						Value:           optValue,
					}
				}
			}
		}
	}

	return nil
}
