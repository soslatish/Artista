// Хуки данных на TanStack Query. Ключи запросов — в одном месте.
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, patch, post, request } from './client';
import type {
  AppNotification,
  ArtistStats,
  Artwork,
  ArtworkInput,
  CatalogMeta,
  Conversation,
  DeliveryQuote,
  Me,
  Message,
  Order,
  Paged,
  PageMeta,
  PublicUser,
  Review,
} from './types';

export const keys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  artworks: (filters: object) => ['artworks', filters] as const,
  artwork: (id: string) => ['artwork', id] as const,
  myArtworks: (status?: string) => ['my-artworks', status ?? 'all'] as const,
  favorites: ['favorites'] as const,
  user: (id: string) => ['user', id] as const,
  userArtworks: (id: string) => ['user-artworks', id] as const,
  reviews: (id: string) => ['reviews', id] as const,
  orders: (role: string, status?: string) => ['orders', role, status ?? 'all'] as const,
  order: (id: string) => ['order', id] as const,
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  notifications: ['notifications'] as const,
  stats: ['stats'] as const,
  quote: (artworkId: string, city: string) => ['quote', artworkId, city] as const,
};

async function page<T>(path: string, query: Record<string, string | number | undefined>): Promise<Paged<T>> {
  const env = await request<T[]>(path, { query });
  return { items: env.data ?? [], meta: (env.meta ?? { next_cursor: null }) as unknown as PageMeta };
}

function usePaged<T>(key: readonly unknown[], path: string, query: Record<string, string | number | undefined> = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => page<T>(path, { ...query, cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled,
  });
}

/** Плоский список из страниц. */
export function flatten<T>(data: InfiniteData<Paged<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

// ---------- каталог ----------

export interface CatalogFilters {
  q?: string;
  category?: string;
  style?: string;
  technique?: string;
  price_min?: number;
  price_max?: number;
  size_max?: number;
  city?: string;
  sort?: string;
  feed?: 'new' | 'popular' | 'for_you';
}

export const useCatalogMeta = () => useQuery({ queryKey: keys.meta, queryFn: () => get<CatalogMeta>('/catalog/meta'), staleTime: Infinity });

export const useArtworks = (filters: CatalogFilters) =>
  usePaged<Artwork>(keys.artworks(filters), '/artworks', filters as Record<string, string | number | undefined>);

export const useArtwork = (id: string) =>
  useQuery({ queryKey: keys.artwork(id), queryFn: () => get<Artwork>(`/artworks/${id}`), enabled: id.length > 0 });

export const useMyArtworks = (status?: string, enabled = true) => usePaged<Artwork>(keys.myArtworks(status), '/me/artworks', { status }, enabled);

export const useFavorites = (enabled: boolean) => usePaged<Artwork>(keys.favorites, '/me/favorites', {}, enabled);

export const useUser = (id: string) =>
  useQuery({ queryKey: keys.user(id), queryFn: () => get<PublicUser>(`/users/${id}`), enabled: id.length > 0 });

export const useUserArtworks = (id: string) => usePaged<Artwork>(keys.userArtworks(id), `/users/${id}/artworks`);

export const useReviews = (id: string) => usePaged<Review>(keys.reviews(id), `/users/${id}/reviews`);

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? post(`/artworks/${id}/favorite`) : del(`/artworks/${id}/favorite`)),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: keys.artwork(id) });
      const prev = qc.getQueryData<Artwork>(keys.artwork(id));
      if (prev) {
        qc.setQueryData<Artwork>(keys.artwork(id), {
          ...prev,
          is_favorite: on,
          favorites_count: prev.favorites_count + (on ? 1 : -1),
        });
      }
      return { prev };
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.artwork(id), ctx.prev);
    },
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: keys.artwork(id) });
      qc.invalidateQueries({ queryKey: keys.favorites });
      qc.invalidateQueries({ queryKey: ['artworks'] });
    },
  });
}

export function useFollow(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => (on ? post(`/users/${userId}/follow`) : del(`/users/${userId}/follow`)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.user(userId) }),
  });
}

// ---------- работы художника ----------

export function useSaveArtwork(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, publish }: { input: ArtworkInput; publish: boolean }) => {
      if (!id) return post<Artwork>('/artworks', { ...input, publish });
      const saved = await patch<Artwork>(`/artworks/${id}`, input);
      return publish && saved.status !== 'published' ? post<Artwork>(`/artworks/${id}/publish`) : saved;
    },
    onSuccess: (a) => {
      qc.setQueryData(keys.artwork(a.id), a);
      qc.invalidateQueries({ queryKey: ['my-artworks'] });
      qc.invalidateQueries({ queryKey: ['artworks'] });
    },
  });
}

export function useArchiveArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/artworks/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: keys.artwork(id) });
      qc.invalidateQueries({ queryKey: ['my-artworks'] });
      qc.invalidateQueries({ queryKey: ['artworks'] });
    },
  });
}

export const useStats = (enabled: boolean) => useQuery({ queryKey: keys.stats, queryFn: () => get<ArtistStats>('/me/stats'), enabled });

// ---------- заказы ----------

export const useOrders = (role: 'buyer' | 'artist', status?: string, enabled = true) =>
  usePaged<Order>(keys.orders(role, status), '/orders', { role, status }, enabled);

export const useOrder = (id: string) =>
  useQuery({ queryKey: keys.order(id), queryFn: () => get<Order>(`/orders/${id}`), refetchInterval: 30_000 });

export const useDeliveryQuotes = (artworkId: string, city: string) =>
  useQuery({
    queryKey: keys.quote(artworkId, city),
    queryFn: () => get<DeliveryQuote[]>('/delivery/quote', { artwork_id: artworkId, city }),
    enabled: city.trim().length >= 2,
    retry: false,
    staleTime: Infinity, // после создания заказа работа зарезервирована — не перезапрашиваем
  });

export function useOrderAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body?: object }) => post<Order>(`/orders/${id}/${action}`, body),
    onSuccess: (o) => {
      qc.setQueryData(keys.order(id), o);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: keys.artwork(o.artwork.id) });
    },
  });
}

// ---------- чат и уведомления ----------

export const useConversations = (enabled: boolean) => usePaged<Conversation>(keys.conversations, '/conversations', {}, enabled);

export const useMessages = (id: string) => usePaged<Message>(keys.messages(id), `/conversations/${id}/messages`, { limit: 50 });

export const useNotifications = (enabled: boolean) => usePaged<AppNotification>(keys.notifications, '/notifications', {}, enabled);

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Me, 'name' | 'city' | 'bio' | 'avatar_url' | 'social'>>) => patch<Me>('/me', body),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}
