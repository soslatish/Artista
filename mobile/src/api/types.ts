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
  vacation_until: string | null;
  vacation_note: string;
  accepts_commissions: boolean;
  commission_note: string;
  locale: 'ru' | 'en';
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
  on_vacation?: boolean;
  vacation_until?: string | null;
}

export type ArtworkStatus = 'draft' | 'published' | 'reserved' | 'sold' | 'archived' | 'hidden' | 'scheduled' | 'auction' | 'commission';

export interface AuctionBrief {
  id: string;
  start_kop: number;
  step_kop: number;
  current_kop: number | null;
  bids_count: number;
  ends_at: string;
}

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
  palette: string[];
  rooms: string[];
  allow_offers: boolean;
  series_id: string | null;
  exhibition_id: string | null;
  is_promoted: boolean;
  auction: AuctionBrief | null;
  /** Цена для текущего пользователя из брони (принятое предложение или выигранный аукцион). */
  my_price_kop: number | null;
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
  rooms: string[];
  allow_offers: boolean;
  series_id: string | null;
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
  colors: ColorOption[];
  rooms: Option[];
  promotion_tariffs: { days: number; price_kop: number }[];
  offer_min_share_bp: number;
}

export interface ColorOption extends Option {
  hex: string;
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
  on_vacation: boolean;
  vacation_until: string | null;
  vacation_note: string;
  accepts_commissions: boolean;
  commission_note: string;
  series_count: number;
  posts_count: number;
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

export type OrderKind = 'artwork' | 'offer' | 'auction' | 'commission';

export interface Order {
  id: string;
  kind: OrderKind;
  ship_days: number | null;
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
  image_url: string;
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

// ---------- функции роста ----------

export interface UploadResult {
  url: string;
  palette: string[];
  width: number;
  height: number;
}

export type OfferStatus = 'pending' | 'countered' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'used';

export interface Offer {
  id: string;
  status: OfferStatus;
  amount_kop: number;
  counter_kop: number | null;
  agreed_kop: number | null;
  message: string;
  expires_at: string;
  artwork: { id: string; title: string; image_url: string };
  price_kop: number;
  buyer: Party;
  artist: Party;
  my_role: 'buyer' | 'artist';
  created_at: string;
}

export interface Bid {
  bidder: string;
  amount_kop: number;
  is_mine: boolean;
  created_at: string;
}

export interface Auction {
  id: string;
  artwork_id: string;
  artist_id: string;
  status: 'live' | 'ended' | 'cancelled';
  start_kop: number;
  step_kop: number;
  current_kop: number | null;
  min_bid_kop: number;
  bids_count: number;
  ends_at: string;
  is_leader: boolean;
  i_won: boolean;
  checkout_until: string | null;
  bids: Bid[];
  artwork: { id: string; title: string; image_url: string };
}

export type CommissionStatus = 'requested' | 'quoted' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface Commission {
  id: string;
  status: CommissionStatus;
  description: string;
  category: string;
  width_cm: number | null;
  height_cm: number | null;
  budget_kop: number | null;
  desired_by: string | null;
  images: string[];
  quote_kop: number | null;
  quote_days: number | null;
  quote_note: string;
  decline_reason: string;
  order_id: string | null;
  conversation_id: string | null;
  expires_at: string | null;
  buyer: Party;
  artist: Party;
  my_role: 'buyer' | 'artist';
  created_at: string;
}

export interface Question {
  id: string;
  body: string;
  answer: string;
  answered_at: string | null;
  author: Party;
  created_at: string;
}

export interface Post {
  id: string;
  body: string;
  images: string[];
  artwork: { id: string; title: string; image_url: string; price_kop: number; status: ArtworkStatus } | null;
  artist: ArtistBrief;
  likes: number;
  liked: boolean;
  created_at: string;
}

export interface Series {
  id: string;
  title: string;
  description: string;
  position: number;
  artworks_count: number;
  cover_url: string;
}

export interface Exhibition {
  id: string;
  title: string;
  description: string;
  cover_url: string;
  starts_at: string;
  status: 'upcoming' | 'open' | 'cancelled';
  artist: ArtistBrief;
  artworks_count: number;
  reminders: number;
  reminded: boolean;
}

export interface CatalogFilter {
  q?: string;
  category?: string;
  style?: string;
  technique?: string;
  city?: string;
  colors?: string[];
  room?: string;
  price_min?: number;
  price_max?: number;
  size_max?: number;
  new_artists?: boolean;
  auction?: boolean;
}

export interface Collection {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  kind: 'manual' | 'filter';
  filters: CatalogFilter;
  preview?: Artwork[];
}

export interface SavedSearch {
  id: string;
  title: string;
  filters: CatalogFilter;
  created_at: string;
}

export interface Certificate {
  code: string;
  status: 'active' | 'transferred';
  issued_at: string;
  artwork: {
    id: string;
    title: string;
    image_url: string;
    category: string;
    technique: string;
    materials: string;
    width_cm: number;
    height_cm: number;
    depth_cm: number;
    year: number | null;
  };
  artist: Party;
  owner: string;
  is_mine: boolean;
  history?: { owner: string; issued_at: string; status: string }[];
  verify_url: string;
  qr_png?: string;
}

export interface DetailedStats {
  days: number;
  views_by_day: { date: string; value: number }[];
  favorites_by_day: { date: string; value: number }[];
  sources: { source: string; views: number }[];
  top_artworks: { id: string; title: string; image_url: string; views: number; favorites: number; orders: number }[];
  funnel: { views: number; favorites: number; orders: number; sales: number };
  new_followers: number;
}

export interface AssistantSuggestion {
  titles: string[];
  description: string;
  tags: string[];
  palette: string[];
  price: { suggested_kop: number; min_kop: number; max_kop: number; basis: 'similar' | 'category' | 'default'; sample_size: number };
}

export interface Promotion {
  id: string;
  artwork: { id: string; title: string; image_url: string };
  days: number;
  price_kop: number;
  status: 'active' | 'ended' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}
