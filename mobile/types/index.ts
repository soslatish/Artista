export type UserRole = 'artist' | 'customer';
export type AppStatus = 'pending' | 'accepted' | 'rejected';
export type EventStatus = 'open' | 'closed' | 'completed';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  avatar_url?: string;
  bio?: string;
  city?: string;
  phone?: string;
  categories?: string;
  rating: number;
  reviews_count: number;
  created_at: string;
}

export interface Service {
  id: number;
  user_id: number;
  title: string;
  category: string;
  description: string;
  price_from?: number;
  price_to?: number;
  images?: string;
  tags?: string;
  is_active: boolean;
  created_at: string;
  owner: User;
}

export interface ServiceApplication {
  id: number;
  service_id: number;
  applicant_id: number;
  message?: string;
  status: AppStatus;
  created_at: string;
  applicant: User;
  service?: Service;
}

export interface Event {
  id: number;
  user_id: number;
  title: string;
  category: string;
  description: string;
  budget_min?: number;
  budget_max?: number;
  event_date?: string;
  city?: string;
  status: EventStatus;
  images?: string;
  created_at: string;
  owner: User;
}

export interface EventApplication {
  id: number;
  event_id: number;
  artist_id: number;
  message?: string;
  price?: number;
  status: AppStatus;
  created_at: string;
  artist: User;
  event?: Event;
}

export interface Message {
  id: number;
  sender_id: number;
  receiver_id: number;
  content: string;
  is_read: boolean;
  created_at: string;
  sender: User;
}

export interface ChatPreview {
  user: User;
  last_message?: Message;
  unread_count: number;
}

export interface Review {
  id: number;
  reviewer_id: number;
  reviewed_id: number;
  rating: number;
  comment?: string;
  images?: string;
  created_at: string;
  reviewer: User;
}
