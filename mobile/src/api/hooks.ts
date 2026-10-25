// Хуки данных на TanStack Query. Ключи запросов — в одном месте.
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { del, get, patch, post, request } from './client';
import type {
  AppNotification,
  ArtistStats,
  Artwork,
  ArtworkInput,
  Auction,
  CatalogMeta,
  Certificate,
  Collection,
  Commission,
  Conversation,
  DeliveryQuote,
  DetailedStats,
  Exhibition,
  Me,
  Message,
  Offer,
  Order,
  Paged,
  PageMeta,
  Post,
  Promotion,
  PublicUser,
  Question,
  Review,
  SavedSearch,
  Series,
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
  quote: (artworkId: string, city: string, price?: number) => ['quote', artworkId, city, price ?? 0] as const,
  similar: (id: string) => ['similar', id] as const,
  questions: (id: string) => ['questions', id] as const,
  history: ['history'] as const,
  savedSearches: ['saved-searches'] as const,
  collections: ['collections'] as const,
  collection: (slug: string) => ['collection', slug] as const,
  offers: (role: string) => ['offers', role] as const,
  offer: (id: string) => ['offer', id] as const,
  auction: (id: string) => ['auction', id] as const,
  commissions: (role: string) => ['commissions', role] as const,
  commission: (id: string) => ['commission', id] as const,
  postsFeed: ['posts-feed'] as const,
  userPosts: (id: string) => ['user-posts', id] as const,
  series: (id: string) => ['series', id] as const,
  exhibitions: (scope: string) => ['exhibitions', scope] as const,
  exhibition: (id: string) => ['exhibition', id] as const,
  certificates: ['certificates'] as const,
  certificate: (code: string) => ['certificate', code] as const,
  detailedStats: (days: number) => ['detailed-stats', days] as const,
  promotions: ['promotions'] as const,
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
  /** коды цветов через запятую */
  colors?: string;
  room?: string;
  auction?: 'true';
  artist_id?: string;
}

// справочники и условия платформы; условия меняются в админке, поэтому перечитываем раз в 10 минут
export const useCatalogMeta = () => useQuery({ queryKey: keys.meta, queryFn: () => get<CatalogMeta>('/catalog/meta'), staleTime: 10 * 60_000 });

/** Включена ли функция платформы (по умолчанию — да, пока условия не загрузились). */
export function useFeature(name: 'registration' | 'offers' | 'auctions' | 'commissions'): boolean {
  const { data } = useCatalogMeta();
  return data?.features?.[name] ?? true;
}

export const useArtworks = (filters: CatalogFilters) =>
  usePaged<Artwork>(keys.artworks(filters), '/artworks', filters as Record<string, string | number | undefined>);

export const useArtwork = (id: string, src?: string) =>
  useQuery({ queryKey: keys.artwork(id), queryFn: () => get<Artwork>(`/artworks/${id}`, { src }), enabled: id.length > 0 });

export const useMyArtworks = (status?: string, enabled = true) => usePaged<Artwork>(keys.myArtworks(status), '/me/artworks', { status }, enabled);

export const useFavorites = (enabled: boolean) => usePaged<Artwork>(keys.favorites, '/me/favorites', {}, enabled);

export const useUser = (id: string) =>
  useQuery({ queryKey: keys.user(id), queryFn: () => get<PublicUser>(`/users/${id}`), enabled: id.length > 0 });

export const useUserArtworks = (id: string, seriesId?: string) =>
  usePaged<Artwork>([...keys.userArtworks(id), seriesId ?? 'all'], `/users/${id}/artworks`, { series_id: seriesId });

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

export const useDeliveryQuotes = (artworkId: string, city: string, priceKop?: number) =>
  useQuery({
    queryKey: keys.quote(artworkId, city, priceKop),
    queryFn: () => get<DeliveryQuote[]>('/delivery/quote', { artwork_id: artworkId, city, price_kop: priceKop }),
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
    mutationFn: (
      body: Partial<Pick<Me, 'name' | 'city' | 'bio' | 'avatar_url' | 'social' | 'vacation_note' | 'accepts_commissions' | 'commission_note' | 'locale'>> & {
        vacation_until?: string;
      },
    ) => patch<Me>('/me', body),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

// ---------- открытие работ ----------

export const useSimilar = (id: string) =>
  useQuery({ queryKey: keys.similar(id), queryFn: () => get<Artwork[]>(`/artworks/${id}/similar`), staleTime: 5 * 60_000 });

export const useQuestions = (id: string) => usePaged<Question>(keys.questions(id), `/artworks/${id}/questions`);

export const useHistory = (enabled: boolean) => usePaged<Artwork>(keys.history, '/me/history', {}, enabled);

export const useSavedSearches = (enabled: boolean) =>
  useQuery({ queryKey: keys.savedSearches, queryFn: () => get<SavedSearch[]>('/me/saved-searches'), enabled });

export const useCollections = () => useQuery({ queryKey: keys.collections, queryFn: () => get<Collection[]>('/collections'), staleTime: 5 * 60_000 });

export const useCollection = (slug: string) => usePaged<Artwork>(keys.collection(slug), `/collections/${slug}`);

// ---------- сделки ----------

export const useOffers = (role: 'buyer' | 'artist', enabled = true) => usePaged<Offer>(keys.offers(role), '/offers', { role }, enabled);

export const useOffer = (id: string) => useQuery({ queryKey: keys.offer(id), queryFn: () => get<Offer>(`/offers/${id}`) });

export const useAuction = (id: string) =>
  useQuery({ queryKey: keys.auction(id), queryFn: () => get<Auction>(`/auctions/${id}`), refetchInterval: 15_000 });

export const useCommissions = (role: 'buyer' | 'artist', enabled = true) =>
  usePaged<Commission>(keys.commissions(role), '/commissions', { role }, enabled);

export const useCommission = (id: string) => useQuery({ queryKey: keys.commission(id), queryFn: () => get<Commission>(`/commissions/${id}`) });

export const usePromotions = (enabled: boolean) => useQuery({ queryKey: keys.promotions, queryFn: () => get<Promotion[]>('/me/promotions'), enabled });

// ---------- художники, посты, выставки ----------

export const usePostsFeed = () => usePaged<Post>(keys.postsFeed, '/feed/posts');

export const useUserPosts = (id: string) => usePaged<Post>(keys.userPosts(id), `/users/${id}/posts`);

export const useUserSeries = (id: string) => useQuery({ queryKey: keys.series(id), queryFn: () => get<Series[]>(`/users/${id}/series`) });

export const useExhibitions = (scope: { status?: 'upcoming' | 'open'; artist_id?: string } = {}) =>
  usePaged<Exhibition>(keys.exhibitions(`${scope.status ?? 'all'}:${scope.artist_id ?? ''}`), '/exhibitions', scope);

export const useExhibition = (id: string) => usePaged<Artwork>(keys.exhibition(id), `/exhibitions/${id}`);

export const useCertificates = (enabled: boolean) => useQuery({ queryKey: keys.certificates, queryFn: () => get<Certificate[]>('/me/certificates'), enabled });

export const useCertificate = (code: string) => useQuery({ queryKey: keys.certificate(code), queryFn: () => get<Certificate>(`/certificates/${code}`) });

export const useDetailedStats = (days: number, enabled: boolean) =>
  useQuery({ queryKey: keys.detailedStats(days), queryFn: () => get<DetailedStats>('/me/stats/detailed', { days }), enabled, retry: false });

/** Мета из ответа страничного списка (подборка, выставка). */
export function pageMeta<T>(data: InfiniteData<Paged<unknown>> | undefined, key: string): T | undefined {
  return (data?.pages[0]?.meta as unknown as Record<string, unknown> | undefined)?.[key] as T | undefined;
}
