import { useLocalSearchParams } from 'expo-router';

import { errorText } from '@/api/client';
import { useArtwork } from '@/api/hooks';
import type { Artwork } from '@/api/types';
import { ArtworkFormScreen } from '@/features/artwork-form';
import { validId } from '@/lib/guard';
import type { ArtworkForm } from '@/lib/validation';
import { ErrorState, Loading } from '@/ui/primitives';

function toForm(a: Artwork): ArtworkForm {
  const n = (v: number) => (v ? String(v).replace('.', ',') : '');
  return {
    title: a.title,
    description: a.description,
    category: a.category,
    style: a.style,
    technique: a.technique,
    materials: a.materials,
    width: n(a.width_cm),
    height: n(a.height_cm),
    depth: n(a.depth_cm),
    year: a.year ? String(a.year) : '',
    price: String(Math.round(a.price_kop / 100)),
    images: a.images,
  };
}

export default function EditArtworkScreen() {
  const id = validId(useLocalSearchParams().id);
  const q = useArtwork(id ?? '');
  if (!id) return <ErrorState text="Ссылка повреждена." />;
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return <ArtworkFormScreen artworkId={id} initial={toForm(q.data)} isPublished={q.data.status === 'published'} />;
}
