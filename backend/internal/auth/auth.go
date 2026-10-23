// Package auth — хеширование паролей, JWT access-токены и непрозрачные refresh-токены.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// BcryptCost — стоимость bcrypt (в тестах можно понизить).
var BcryptCost = 12

const issuer = "artista"

// ErrInvalidToken — токен просрочен, подделан или некорректен.
var ErrInvalidToken = errors.New("invalid token")

// HashPassword хеширует пароль bcrypt.
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(h), nil
}

// CheckPassword сравнивает пароль с хешем за постоянное время.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Claims — данные из access-токена.
type Claims struct {
	UserID string
	Role   string
}

type jwtClaims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// TokenManager выпускает и проверяет access-токены (HS256).
type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

// NewTokenManager создаёт менеджер токенов.
func NewTokenManager(secret []byte, ttl time.Duration) *TokenManager {
	return &TokenManager{secret: secret, ttl: ttl}
}

// TTL — срок жизни access-токена.
func (m *TokenManager) TTL() time.Duration { return m.ttl }

// Issue выпускает access-токен.
func (m *TokenManager) Issue(userID, role string) (string, error) {
	now := time.Now()
	c := jwtClaims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Issuer:    issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return s, nil
}

// Parse проверяет подпись, алгоритм, издателя и срок.
func (m *TokenManager) Parse(token string) (Claims, error) {
	var c jwtClaims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return m.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || c.Subject == "" {
		return Claims{}, ErrInvalidToken
	}
	return Claims{UserID: c.Subject, Role: c.Role}, nil
}

// NewOpaqueToken создаёт случайный токен (для refresh) и его SHA-256 хеш для хранения в БД.
func NewOpaqueToken() (token, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("random: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

// HashToken — SHA-256 от токена или кода (hex).
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// NewResetCode — 6-значный код для сброса пароля.
func NewResetCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
