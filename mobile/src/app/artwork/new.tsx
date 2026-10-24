import { router } from 'expo-router';

import { useSession } from '@/auth/session';
import { ArtworkFormScreen } from '@/features/artwork-form';
import { useT } from '@/i18n';
import { emptyArtworkForm } from '@/lib/validation';
import { Button, EmptyState } from '@/ui/primitives';

export default function NewArtworkScreen() {
  const { user } = useSession();
  const t = useT();
  if (user?.role !== 'artist') {
    return (
      <EmptyState
        icon="brush-outline"
        title={t('Только для художников')}
        text={t('Откройте мастерскую в профиле, чтобы публиковать работы.')}
        action={<Button title={t('В профиль')} onPress={() => router.navigate('/profile')} />}
      />
    );
  }
  return <ArtworkFormScreen initial={emptyArtworkForm} />;
}
