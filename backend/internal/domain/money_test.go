package domain

import (
	"errors"
	"testing"
)

func TestCommission(t *testing.T) {
	tests := []struct {
		name       string
		price      int64
		premium    bool
		monthSales int64
		want       int64
	}{
		{"regular 15%", 20_000_00, false, 0, 3_000_00},
		{"regular rounds half up", 3_333_33, false, 0, 50_000},
		{"premium under limit is free", 20_000_00, true, 0, 0},
		{"premium exactly at limit is free", 100_000_00, true, 0, 0},
		{"premium crosses limit partially", 20_000_00, true, 90_000_00, 1_500_00},
		{"premium already over limit", 20_000_00, true, 150_000_00, 3_000_00},
		{"regular ignores month sales", 10_000_00, false, 500_000_00, 1_500_00},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Commission(tt.price, tt.premium, tt.monthSales); got != tt.want {
				t.Errorf("Commission() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestQuoteDelivery(t *testing.T) {
	tests := []struct {
		name    string
		method  DeliveryMethod
		city    string
		price   int64
		maxSide float64
		want    int64
		wantErr error
	}{
		{"cdek moscow", DeliveryCDEK, "Москва", 20_000_00, 60, 500_00, nil},
		{"cdek spb alias", DeliveryCDEK, " спб ", 20_000_00, 60, 500_00, nil},
		{"express spb", DeliveryExpress, "Санкт-Петербург", 20_000_00, 60, 800_00, nil},
		{"express unavailable in regions", DeliveryExpress, "Казань", 20_000_00, 60, 0, ErrDeliveryUnavailable},
		{"cdek region", DeliveryCDEK, "Казань", 20_000_00, 60, 1_500_00, nil},
		{"post region", DeliveryPost, "Томск", 20_000_00, 60, 1_000_00, nil},
		{"large artwork surcharge region", DeliveryCDEK, "Казань", 20_000_00, 150, 3_000_00, nil},
		{"large artwork surcharge capital", DeliveryCDEK, "Москва", 20_000_00, 150, 800_00, nil},
		{"free from 50k", DeliveryCDEK, "Казань", 50_000_00, 150, 0, nil},
		{"unknown method", DeliveryMethod("drone"), "Москва", 20_000_00, 60, 0, ErrUnknownDeliveryMethod},
		{"empty city", DeliveryCDEK, "  ", 20_000_00, 60, 0, ErrCityRequired},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := QuoteDelivery(tt.method, tt.city, tt.price, tt.maxSide)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got.PriceKop != tt.want {
				t.Errorf("price = %d, want %d", got.PriceKop, tt.want)
			}
			if got.DaysMin <= 0 || got.DaysMax < got.DaysMin {
				t.Errorf("bad days range %d..%d", got.DaysMin, got.DaysMax)
			}
		})
	}
}

func TestIsCapital(t *testing.T) {
	for _, c := range []string{"Москва", "moscow", "Санкт-Петербург", "СПб", "питер", "Saint Petersburg"} {
		if !IsCapital(c) {
			t.Errorf("%q should be capital", c)
		}
	}
	if IsCapital("Тверь") {
		t.Error("Тверь is not a capital")
	}
}
