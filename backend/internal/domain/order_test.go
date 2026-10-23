package domain

import (
	"errors"
	"testing"
	"time"
)

func TestNextStatus(t *testing.T) {
	tests := []struct {
		name    string
		from    OrderStatus
		action  OrderAction
		actor   Actor
		want    OrderStatus
		wantErr error
	}{
		{"payment succeeds", StatusAwaitingPayment, ActionPay, ActorSystem, StatusPaid, nil},
		{"buyer cannot mark paid", StatusAwaitingPayment, ActionPay, ActorBuyer, "", ErrForbiddenTransition},
		{"artist confirms paid order", StatusPaid, ActionConfirm, ActorArtist, StatusConfirmed, nil},
		{"buyer cannot confirm", StatusPaid, ActionConfirm, ActorBuyer, "", ErrForbiddenTransition},
		{"artist declines paid order", StatusPaid, ActionDecline, ActorArtist, StatusCancelled, nil},
		{"artist cannot decline after confirm", StatusConfirmed, ActionDecline, ActorArtist, "", ErrInvalidTransition},
		{"artist ships confirmed order", StatusConfirmed, ActionShip, ActorArtist, StatusShipped, nil},
		{"cannot ship unconfirmed", StatusPaid, ActionShip, ActorArtist, "", ErrInvalidTransition},
		{"buyer completes shipped", StatusShipped, ActionComplete, ActorBuyer, StatusCompleted, nil},
		{"system auto-completes shipped", StatusShipped, ActionComplete, ActorSystem, StatusCompleted, nil},
		{"artist cannot complete", StatusShipped, ActionComplete, ActorArtist, "", ErrForbiddenTransition},
		{"buyer cancels unpaid", StatusAwaitingPayment, ActionCancel, ActorBuyer, StatusCancelled, nil},
		{"buyer cancels paid before confirm", StatusPaid, ActionCancel, ActorBuyer, StatusCancelled, nil},
		{"buyer cannot cancel confirmed", StatusConfirmed, ActionCancel, ActorBuyer, "", ErrForbiddenTransition},
		{"system cancels confirmed on timeout", StatusConfirmed, ActionCancel, ActorSystem, StatusCancelled, nil},
		{"nothing after completed", StatusCompleted, ActionCancel, ActorSystem, "", ErrInvalidTransition},
		{"nothing after cancelled", StatusCancelled, ActionPay, ActorSystem, "", ErrInvalidTransition},
		{"unknown action", StatusPaid, OrderAction("teleport"), ActorSystem, "", ErrInvalidTransition},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NextStatus(tt.from, tt.action, tt.actor)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDeadlineFor(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		status OrderStatus
		want   time.Duration
		none   bool
	}{
		{StatusAwaitingPayment, 30 * time.Minute, false},
		{StatusPaid, 24 * time.Hour, false},
		{StatusConfirmed, 48 * time.Hour, false},
		{StatusShipped, 14 * 24 * time.Hour, false},
		{StatusCompleted, 0, true},
		{StatusCancelled, 0, true},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			got := DeadlineFor(tt.status, now)
			if tt.none {
				if got != nil {
					t.Fatalf("want no deadline, got %v", got)
				}
				return
			}
			if got == nil || !got.Equal(now.Add(tt.want)) {
				t.Fatalf("got %v, want %v", got, now.Add(tt.want))
			}
		})
	}
}

func TestTimeoutAction(t *testing.T) {
	tests := []struct {
		status OrderStatus
		want   OrderAction
		ok     bool
	}{
		{StatusAwaitingPayment, ActionCancel, true},
		{StatusPaid, ActionCancel, true},
		{StatusConfirmed, ActionCancel, true},
		{StatusShipped, ActionComplete, true},
		{StatusCompleted, "", false},
	}
	for _, tt := range tests {
		got, ok := TimeoutAction(tt.status)
		if ok != tt.ok || got != tt.want {
			t.Errorf("%s: got (%q,%v), want (%q,%v)", tt.status, got, ok, tt.want, tt.ok)
		}
		if ok {
			if _, err := NextStatus(tt.status, got, ActorSystem); err != nil {
				t.Errorf("%s: timeout action must be a valid system transition: %v", tt.status, err)
			}
		}
	}
}

func TestIsActive(t *testing.T) {
	for _, s := range []OrderStatus{StatusAwaitingPayment, StatusPaid, StatusConfirmed, StatusShipped} {
		if !s.IsActive() {
			t.Errorf("%s should be active", s)
		}
	}
	for _, s := range []OrderStatus{StatusCompleted, StatusCancelled} {
		if s.IsActive() {
			t.Errorf("%s should not be active", s)
		}
	}
}

func TestNeedsRefund(t *testing.T) {
	if NeedsRefund(StatusAwaitingPayment) {
		t.Error("unpaid order needs no refund")
	}
	if !NeedsRefund(StatusPaid) || !NeedsRefund(StatusConfirmed) {
		t.Error("paid/confirmed cancellation must refund")
	}
}
