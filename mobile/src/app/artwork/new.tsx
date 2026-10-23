import { router } from 'expo-router';

import { useSession } from '@/auth/session';
import { ArtworkFormScreen } from '@/features/artwork-form';
import { emptyArtworkForm } from '@/lib/validation';
import { Button, EmptyState } from '@/ui/primitives';

export default function NewArtworkScreen() {
  const { user } = useSession();
  if (user?.role !== 'artist') {
    return (
      <EmptyState
        icon="brush-outline"
        title="Только для художников"
        text="Откройте мастерскую в профиле, чтобы публиковать работы."
        action={<Button title="В профиль" onPress={() => router.navigate('/profile')} />}
      />
    );
  }
  return <ArtworkFormScreen initial={emptyArtworkForm} />;
}
