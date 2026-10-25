// Package domain содержит бизнес-правила Artista в виде чистых функций:
// машину состояний заказа, комиссию, тарифы доставки и валидацию.
package domain

import (
	"errors"
	"time"
)

// OrderStatus — статус заказа.
type OrderStatus string

const (
	StatusAwaitingPayment OrderStatus = "awaiting_payment"
	StatusPaid            OrderStatus = "paid"
	StatusConfirmed       OrderStatus = "confirmed"
	StatusShipped         OrderStatus = "shipped"
	StatusCompleted       OrderStatus = "completed"
	StatusCancelled       OrderStatus = "cancelled"
)

// IsActive — заказ ещё не завершён и держит работу в резерве.
func (s OrderStatus) IsActive() bool {
	switch s {
	case StatusAwaitingPayment, StatusPaid, StatusConfirmed, StatusShipped:
		return true
	}
	return false
}

// OrderAction — действие над заказом.
type OrderAction string

const (
	ActionPay      OrderAction = "pay"
	ActionConfirm  OrderAction = "confirm"
	ActionDecline  OrderAction = "decline"
	ActionShip     OrderAction = "ship"
	ActionComplete OrderAction = "complete"
	ActionCancel   OrderAction = "cancel"
)

// Actor — кто выполняет действие.
type Actor string

const (
	ActorBuyer  Actor = "buyer"
	ActorArtist Actor = "artist"
	ActorSystem Actor = "system"
	ActorAdmin  Actor = "admin" // администратор: разбор споров
)

var (
	ErrInvalidTransition   = errors.New("invalid order transition")
	ErrForbiddenTransition = errors.New("actor is not allowed to perform this transition")
)

type transition struct {
	from   OrderStatus
	action OrderAction
}

type rule struct {
	to     OrderStatus
	actors []Actor
}

var transitions = map[transition]rule{
	{StatusAwaitingPayment, ActionPay}:    {StatusPaid, []Actor{ActorSystem}},
	{StatusAwaitingPayment, ActionCancel}: {StatusCancelled, []Actor{ActorBuyer, ActorSystem, ActorAdmin}},
	{StatusPaid, ActionConfirm}:           {StatusConfirmed, []Actor{ActorArtist}},
	{StatusPaid, ActionDecline}:           {StatusCancelled, []Actor{ActorArtist}},
	{StatusPaid, ActionCancel}:            {StatusCancelled, []Actor{ActorBuyer, ActorSystem, ActorAdmin}},
	{StatusConfirmed, ActionShip}:         {StatusShipped, []Actor{ActorArtist}},
	{StatusConfirmed, ActionCancel}:       {StatusCancelled, []Actor{ActorSystem, ActorAdmin}},
	{StatusShipped, ActionComplete}:       {StatusCompleted, []Actor{ActorBuyer, ActorSystem, ActorAdmin}},
	{StatusShipped, ActionCancel}:         {StatusCancelled, []Actor{ActorAdmin}}, // спор: работа не пришла или не та
}

// NextStatus возвращает новый статус или ошибку, если переход невозможен
// или запрещён для данного участника.
func NextStatus(from OrderStatus, action OrderAction, actor Actor) (OrderStatus, error) {
	r, ok := transitions[transition{from, action}]
	if !ok {
		return "", ErrInvalidTransition
	}
	for _, a := range r.actors {
		if a == actor {
			return r.to, nil
		}
	}
	return "", ErrForbiddenTransition
}

// Сроки, после которых система сама двигает заказ.
const (
	PaymentTimeout = 30 * time.Minute
	ConfirmTimeout = 24 * time.Hour
	ShipTimeout    = 48 * time.Hour
	ReceiptTimeout = 14 * 24 * time.Hour
)

// DeadlineFor — когда истекает текущий статус (nil для финальных статусов).
func DeadlineFor(status OrderStatus, from time.Time) *time.Time {
	var d time.Duration
	switch status {
	case StatusAwaitingPayment:
		d = PaymentTimeout
	case StatusPaid:
		d = ConfirmTimeout
	case StatusConfirmed:
		d = ShipTimeout
	case StatusShipped:
		d = ReceiptTimeout
	default:
		return nil
	}
	t := from.Add(d)
	return &t
}

// TimeoutAction — что делает система, когда срок статуса истёк.
func TimeoutAction(status OrderStatus) (OrderAction, bool) {
	switch status {
	case StatusAwaitingPayment, StatusPaid, StatusConfirmed:
		return ActionCancel, true
	case StatusShipped:
		return ActionComplete, true
	}
	return "", false
}

// NeedsRefund — нужно ли возвращать деньги при отмене из данного статуса.
func NeedsRefund(from OrderStatus) bool {
	return from == StatusPaid || from == StatusConfirmed || from == StatusShipped
}
