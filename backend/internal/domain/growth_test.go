package domain

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateOffer(t *testing.T) {
	tests := []struct {
		name          string
		price, amount int64
		want          error
	}{
		{"half price is allowed", 20_000_00, 10_000_00, nil},
		{"below half", 20_000_00, 9_999_00, ErrOfferTooLow},
		{"equal to price", 20_000_00, 20_000_00, ErrOfferTooHigh},
		{"above price", 20_000_00, 25_000_00, ErrOfferTooHigh},
		{"below minimum artwork price", 5_000_00, 2_900_00, ErrOfferTooLow},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateOffer(tt.price, tt.amount); !errors.Is(err, tt.want) {
				t.Fatalf("ValidateOffer(%d, %d) = %v, want %v", tt.price, tt.amount, err, tt.want)
			}
		})
	}
	if got := OfferMinimum(20_000_00); got != 10_000_00 {
		t.Fatalf("OfferMinimum = %d", got)
	}
	if got := OfferMinimum(4_000_00); got != MinArtworkPriceKop {
		t.Fatalf("OfferMinimum floor = %d", got)
	}
}

func TestAuctionStepAndBids(t *testing.T) {
	tests := []struct{ start, want int64 }{
		{3_000_00, 150_00},
		{1_000_00, 100_00},
		{25_000_00, 1_250_00},
		{10_100_00, 550_00}, // 505 ₽ → округление вверх до 550 ₽
	}
	for _, tt := range tests {
		if got := AuctionStep(tt.start); got != tt.want {
			t.Errorf("AuctionStep(%d) = %d, want %d", tt.start, got, tt.want)
		}
	}
	if got := MinNextBid(10_000_00, 500_00, nil); got != 10_000_00 {
		t.Errorf("first bid = %d", got)
	}
	cur := int64(12_000_00)
	if got := MinNextBid(10_000_00, 500_00, &cur); got != 12_500_00 {
		t.Errorf("next bid = %d", got)
	}
}

func TestExtendForSnipe(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	far := now.Add(time.Hour)
	if got := ExtendForSnipe(far, now); !got.Equal(far) {
		t.Fatalf("far end changed: %v", got)
	}
	near := now.Add(2 * time.Minute)
	if got := ExtendForSnipe(near, now); !got.Equal(now.Add(AuctionSnipeWindow)) {
		t.Fatalf("snipe not extended: %v", got)
	}
}

func TestShipDeadline(t *testing.T) {
	at := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	if got := ShipDeadline(at, nil); !got.Equal(at.Add(ShipTimeout)) {
		t.Fatalf("default = %v", got)
	}
	days := 10
	if got := ShipDeadline(at, &days); !got.Equal(at.Add(12 * 24 * time.Hour)) {
		t.Fatalf("commission = %v", got)
	}
}

func TestPromotionAndRooms(t *testing.T) {
	if p, ok := PromotionPrice(7); !ok || p != 399_00 {
		t.Fatalf("PromotionPrice(7) = %d %v", p, ok)
	}
	if _, ok := PromotionPrice(5); ok {
		t.Fatal("unknown tariff accepted")
	}
	if !ValidRooms([]string{"living", "office"}) || ValidRooms([]string{"living", "living"}) || ValidRooms([]string{"garage"}) {
		t.Fatal("ValidRooms")
	}
	if !IsColor("blue") || IsColor("magenta") {
		t.Fatal("IsColor")
	}
}

func TestCertificateCode(t *testing.T) {
	code := CertificateCode([]byte{0, 1, 2, 3, 4, 5, 6, 7})
	if len(code) != 13 || !strings.HasPrefix(code, "ART-") || code[8] != '-' {
		t.Fatalf("code = %q", code)
	}
	if strings.ContainsAny(code[4:], "01ILO") {
		t.Fatalf("ambiguous symbols in %q", code)
	}
}
