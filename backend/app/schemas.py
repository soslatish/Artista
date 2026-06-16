from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from .models import UserRole, ApplicationStatus, EventStatus


# ─── Auth ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ─── User ───────────────────────────────────────────────────────────────────
class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: UserRole
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    categories: Optional[str] = None
    rating: float
    reviews_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    categories: Optional[str] = None


# ─── Service ────────────────────────────────────────────────────────────────
class ServiceCreate(BaseModel):
    title: str
    category: str
    description: str
    price_from: Optional[float] = None
    price_to: Optional[float] = None
    tags: Optional[str] = None


class ServiceOut(BaseModel):
    id: int
    user_id: int
    title: str
    category: str
    description: str
    price_from: Optional[float] = None
    price_to: Optional[float] = None
    images: Optional[str] = None
    tags: Optional[str] = None
    is_active: bool
    created_at: datetime
    owner: UserOut

    class Config:
        from_attributes = True


# ─── Service Application ────────────────────────────────────────────────────
class ServiceApplicationCreate(BaseModel):
    message: Optional[str] = None


class ServiceApplicationOut(BaseModel):
    id: int
    service_id: int
    applicant_id: int
    message: Optional[str] = None
    status: ApplicationStatus
    created_at: datetime
    applicant: UserOut
    service: Optional["ServiceOut"] = None

    class Config:
        from_attributes = True


# ─── Event ──────────────────────────────────────────────────────────────────
class EventCreate(BaseModel):
    title: str
    category: str
    description: str
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    event_date: Optional[str] = None
    city: Optional[str] = None


class EventOut(BaseModel):
    id: int
    user_id: int
    title: str
    category: str
    description: str
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    event_date: Optional[str] = None
    city: Optional[str] = None
    status: EventStatus
    images: Optional[str] = None
    created_at: datetime
    owner: UserOut

    class Config:
        from_attributes = True


# ─── Event Application ──────────────────────────────────────────────────────
class EventApplicationCreate(BaseModel):
    message: Optional[str] = None
    price: Optional[float] = None


class EventApplicationOut(BaseModel):
    id: int
    event_id: int
    artist_id: int
    message: Optional[str] = None
    price: Optional[float] = None
    status: ApplicationStatus
    created_at: datetime
    artist: UserOut
    event: Optional[EventOut] = None

    class Config:
        from_attributes = True


# ─── Message ────────────────────────────────────────────────────────────────
class MessageCreate(BaseModel):
    content: str


class MessageOut(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    is_read: bool
    created_at: datetime
    sender: UserOut

    class Config:
        from_attributes = True


class ChatPreview(BaseModel):
    user: UserOut
    last_message: Optional[MessageOut] = None
    unread_count: int


# ─── Review ─────────────────────────────────────────────────────────────────
class ReviewCreate(BaseModel):
    reviewed_id: int
    rating: int
    comment: Optional[str] = None


class ReviewOut(BaseModel):
    id: int
    reviewer_id: int
    reviewed_id: int
    rating: int
    comment: Optional[str] = None
    images: Optional[str] = None
    created_at: datetime
    reviewer: UserOut

    class Config:
        from_attributes = True


TokenResponse.model_rebuild()
ServiceApplicationOut.model_rebuild()
