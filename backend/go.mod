module github.com/soslatish/artista/backend

go 1.24

require (
	github.com/coder/websocket v1.8.15
	github.com/golang-jwt/jwt/v5 v5.2.3
	github.com/jackc/pgx/v5 v5.7.5
	golang.org/x/crypto v0.39.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.15.0 // indirect
	golang.org/x/text v0.26.0 // indirect
)

// golang.org/x/* и gopkg.in недоступны из среды разработки — берём те же модули с GitHub-зеркал.
// В обычном окружении эти replace можно удалить.
replace (
	golang.org/x/crypto => github.com/golang/crypto v0.39.0
	golang.org/x/net => github.com/golang/net v0.41.0
	golang.org/x/sync => github.com/golang/sync v0.15.0
	golang.org/x/sys => github.com/golang/sys v0.33.0
	golang.org/x/term => github.com/golang/term v0.32.0
	golang.org/x/text => github.com/golang/text v0.26.0
	gopkg.in/check.v1 => github.com/go-check/check v0.0.0-20201130134442-10cb98267c6c
	gopkg.in/yaml.v3 => github.com/go-yaml/yaml v0.0.0-20220527083530-f6f7691b1fde
)
