// Админка: типы ответов и хуки. Списки — со смещением (offset) и общим числом строк.
import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { get, request } from './client';

export interface AdminPageMeta {
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
}

export interface AdminPage<T> {
  items: T[];
  meta: AdminPageMeta;
}

export interface PlatformSettings {
  commission_bp: number;
  premium_price_kop: number;
  premium_free_limit_kop: number;
  offer_min_share_bp: number;
  promotion_tariffs: { days: number; price_kop: number }[];
  announcement: string;
  registration_open: boolean;
  offers_enabled: boolean;
  auctions_enabled: boolean;
  commissions_enabled: boolean;
  safe_deals: boolean;
  promotion_sales: boolean;
}

export interface SettingsResponse {
  settings: PlatformSettings;
  defaults: PlatformSettings;
  updated_at: string | null;
  updated_by: string;
}

export interface Dashboard {
  users: { Total: number; Buyers: number; Artists: number; Admins: number; Banned: number; Premium: number; New7d: number; New30d: number };
  artworks: Record<string, number>;
  orders: Record<string, number>;
  money: {
    GMVMonthKop: number;
    GMVTotalKop: number;
    CommissionMonthKop: number;
    CommissionTotalKop: number;
    HeldKop: number;
    SubscriptionsMonthKop: number;
    PromotionsMonthKop: number;
  };
  activity: {
    OpenReports: number;
    LiveAuctions: number;
    ActivePromotions: number;
    UpcomingExhibitions: number;
    PendingOffers: number;
    OpenCommissions: number;
    RefundsPending: number;
  };
  daily: { date: string; signups: number; orders: number; revenue_kop: number }[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'buyer' | 'artist' | 'admin';
  city: string;
  avatar_url: string;
  premium_until: string | null;
  banned_at: string | null;
  deleted_at: string | null;
  created_at: string;
  artworks: number;
  purchases: number;
  sales: number;
  sales_kop: number;
  spent_kop: number;
  reports: number;
}

export interface AuditEntry {
  id: number;
  admin_id: string | null;
  admin_name: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AdminArtwork {
  id: string;
  title: string;
  status: string;
  price_kop: number;
  image_url: string;
  artist_id: string;
  artist_name: string;
  views: number;
  favorites: number;
  reports: number;
  is_promoted: boolean;
  created_at: string;
  category: string;
}

export interface AdminOrder {
  id: string;
  kind: string;
  status: string;
  payout_status: string;
  artwork_id: string;
  artwork_title: string;
  image_url: string;
  buyer_id: string;
  buyer_name: string;
  artist_id: string;
  artist_name: string;
  price_kop: number;
  delivery_kop: number;
  commission_kop: number;
  total_kop: number;
  delivery_method: string;
  tracking_number: string;
  cancel_reason: string;
  address?: Record<string, string>;
  deadline_at: string | null;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface AdminPayment {
  id: string;
  purpose: string;
  status: string;
  amount_kop: number;
  provider: string;
  external_id: string;
  user_id: string;
  user_name: string;
  order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminUserDetail extends AdminUser {
  bio: string;
  locale: string;
  followers: number;
  on_vacation: boolean;
  recent_orders: AdminOrder[];
  recent_artworks: AdminArtwork[];
  admin_actions: AuditEntry[];
}

export interface AdminOrderDetail extends AdminOrder {
  payments: AdminPayment[];
  admin_actions: AuditEntry[];
}

export interface AdminDeal {
  id: string;
  type: 'auction' | 'offer' | 'commission' | 'exhibition';
  status: string;
  title: string;
  image_url: string;
  artwork_id: string | null;
  artist_id: string;
  artist_name: string;
  other_id: string | null;
  other_name: string;
  amount_kop: number | null;
  count: number;
  at: string | null;
  created_at: string;
}

export interface AdminContent {
  id: string;
  type: 'post' | 'question';
  body: string;
  extra: string;
  image_url: string;
  author_id: string;
  author_name: string;
  artwork_id: string | null;
  hidden_at: string | null;
  reports: number;
  created_at: string;
}

export interface AdminReport {
  id: string;
  reporter_id: string;
  reporter_name: string;
  target_type: string;
  target_id: string;
  target_label: string;
  reason: string;
  status: string;
  resolution: string;
  created_at: string;
}

export interface AdminCertificate {
  code: string;
  status: string;
  artwork_id: string;
  title: string;
  artist_name: string;
  owner_id: string;
  owner_name: string;
  issued_at: string;
}

export interface AdminCollection {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  kind: 'manual' | 'filter';
  filters: Record<string, unknown>;
  position: number;
  is_published: boolean;
  artwork_ids?: string[];
}

export type AdminQuery = Record<string, string | number | undefined>;

export const adminKeys = {
  all: ['admin'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  settings: ['admin', 'settings'] as const,
  list: (path: string, query: AdminQuery) => ['admin', 'list', path, query] as const,
  user: (id: string) => ['admin', 'user', id] as const,
  order: (id: string) => ['admin', 'order', id] as const,
};

/** Постраничный список админки: /admin/<path>?offset=… */
export function useAdminList<T>(path: string, query: AdminQuery = {}) {
  return useInfiniteQuery({
    queryKey: adminKeys.list(path, query),
    queryFn: async ({ pageParam }): Promise<AdminPage<T>> => {
      const env = await request<T[]>(`/admin/${path}`, { query: { ...query, offset: pageParam || undefined } });
      const meta = (env.meta ?? {}) as Partial<AdminPageMeta>;
      return { items: env.data ?? [], meta: { total: meta.total ?? env.data?.length ?? 0, offset: meta.offset ?? 0, limit: meta.limit ?? 50, next_offset: meta.next_offset ?? null } };
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.meta.next_offset ?? undefined,
  });
}

export function flattenAdmin<T>(data: InfiniteData<AdminPage<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

export function adminTotal(data: InfiniteData<AdminPage<unknown>> | undefined): number {
  return data?.pages[0]?.meta.total ?? 0;
}

export const useDashboard = () => useQuery({ queryKey: adminKeys.dashboard, queryFn: () => get<Dashboard>('/admin/dashboard'), refetchInterval: 60_000 });
export const useAdminSettings = () => useQuery({ queryKey: adminKeys.settings, queryFn: () => get<SettingsResponse>('/admin/settings') });
export const useAdminUser = (id: string) => useQuery({ queryKey: adminKeys.user(id), queryFn: () => get<AdminUserDetail>(`/admin/users/${id}`) });
export const useAdminOrder = (id: string) => useQuery({ queryKey: adminKeys.order(id), queryFn: () => get<AdminOrderDetail>(`/admin/orders/${id}`) });
export const useAdminReports = (status: string) =>
  useQuery({ queryKey: ['admin', 'reports', status], queryFn: () => get<AdminReport[]>('/admin/reports', { status, limit: 100 }) });
export const useAdminCollections = () => useQuery({ queryKey: ['admin', 'collections'], queryFn: () => get<AdminCollection[]>('/admin/collections') });
export const useAudit = () => useQuery({ queryKey: ['admin', 'audit'], queryFn: () => get<AuditEntry[]>('/admin/audit', { limit: 200 }) });
