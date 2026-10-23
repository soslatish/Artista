// Типы ответов Artista API v1 (см. backend/internal/api).

export type Role = 'buyer' | 'artist' | 'admin';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  city: string;
  bio: string;
  avatar_url: string;
  social: Record<string, string>;
  is_premium: boolean;
  premium_until: string | null;
  created_at: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthResponse {
  user: Me;
  tokens: Tokens;
}

export interface ArtistBrief {
  id: string;
  name: string;
  avatar_url: string;
  city: string;
  is_premium: boolean;
}

export type ArtworkStatus = 'draft' | 'published' | 'reserved' | 'sold' | 'archived' | 'hidden';

export interface Artwork {
  id: string;
  title: string;
  description: string;
  category: string;
  style: string;
  technique: string;
  materials: string;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  year: number | null;
  price_kop: number;
  status: ArtworkStatus;
  views: number;
  favorites_count: number;
  is_favorite: boolean;
  images: string[];
  artist: ArtistBrief;
  published_at: string | null;
  created_at: string;
}

export interface ArtworkInput {
  title: string;
  description: string;
  category: string;
  style: string;
  technique: string;
  materials: string;
  width_cm: number;
  height_cm: number;
  depth_cm: number;
  year: number | null;
  price_kop: number;
  images: string[];
}

export interface Option {
  code: string;
  label: string;
}

export interface CatalogMeta {
  categories: Option[];
  styles: Option[];
  techniques: Option[];
  delivery_methods: Option[];
  price_min_kop: number;
  price_max_kop: number;
  commission_bp: number;
  premium_price_kop: number;
}

export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  city: string;
  bio: string;
  avatar_url: string;
  social: Record<string, string>;
  is_premium: boolean;
  rating: number | null;
  reviews_count: number;
  followers: number;
  artworks_count: number;
  is_following: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  rating: number;
  text: string;
  author: Party;
  artwork_title: string;
  created_at: string;
}

export type DeliveryMethod = 'cdek' | 'express' | 'post';

export interface DeliveryQuote {
  method: DeliveryMethod;
  price_kop: number;
  days_min: number;
  days_max: number;
}

export interface Address {
  city: string;
  street: string;
  postal_code: string;
  recipient_name: string;
  phone: string;
  comment: string;
}

export type OrderStatus = 'awaiting_payment' | 'paid' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';

export interface Party {
  id: string;
  name: string;
  avatar_url: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  price_kop: number;
  delivery_kop: number;
  commission_kop?: number;
  payout_kop?: number;
  total_kop: number;
  delivery_method: DeliveryMethod;
  address: Address;
  tracking_number: string;
  payout_status?: 'none' | 'held' | 'released' | 'refunded';
  cancel_reason: string;
  deadline_at: string | null;
  artwork: { id: string; title: string; image_url: string };
  buyer: Party;
  artist: Party;
  my_role: 'buyer' | 'artist';
  has_review: boolean;
  paid_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  provider: string;
  amount_kop: number;
  status: string;
  confirmation_url: string;
  test_mode: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  other: Party;
  artwork: { id: string; title: string; image_url: string } | null;
  last_message: Message | null;
  unread: number;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ArtistStats {
  published_artworks: number;
  total_views: number;
  total_favorites: number;
  followers: number;
  sales_total: number;
  revenue_total_kop: number;
  sales_month: number;
  revenue_month_kop: number;
  active_orders: number;
}

export interface PageMeta {
  next_cursor: string | null;
  unread?: number;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}
