module github.com/norma-core/norma-core/shared/gremlin_go/bin

go 1.25

require (
	github.com/emicklei/proto v1.14.2
	github.com/google/go-cmp v0.7.0
	github.com/logrusorgru/aurora v2.0.3+incompatible
	github.com/norma-core/norma-core/shared/gremlin_go v0.0.0-00010101000000-000000000000
)

replace github.com/norma-core/norma-core/shared/gremlin_go => ../
