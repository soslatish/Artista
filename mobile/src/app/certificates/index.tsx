import { router } from 'expo-router';
import { FlatList, RefreshControl } from 'react-native';

import { errorText } from '@/api/client';
import { useCertificates } from '@/api/hooks';
import { useSession } from '@/auth/session';
import { SignInGate } from '@/features/sign-in-gate';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { EmptyState, ErrorState, Loading } from '@/ui/primitives';
import { DealRow } from '@/ui/rows';
import { makeStyles, useColors } from '@/ui/theme';

export default function CertificatesScreen() {
  const t = useT();
  const styles = useStyles();
  const colors = useColors();
  const { user } = useSession();
  const q = useCertificates(!!user);
  if (!user) return <SignInGate text={t('Сертификаты подлинности купленных работ хранятся в аккаунте.')} />;
  if (q.isLoading) return <Loading />;
  if (q.isError && !q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.root}
      data={q.data ?? []}
      keyExtractor={(c) => c.code}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.bordeaux} />}
      renderItem={({ item: c }) => (
        <DealRow
          image={c.artwork.image_url}
          title={c.artwork.title}
          subtitle={c.artist.name}
          status={c.status === 'active' ? c.code : t('Передан')}
          statusColor={c.status === 'active' ? colors.success : colors.graphite}
          rightSub={formatDate(c.issued_at)}
          onPress={() => router.push({ pathname: '/certificate/[code]', params: { code: c.code } })}
        />
      )}
      ListEmptyComponent={
        <EmptyState
          icon="ribbon-outline"
          title={t('Сертификатов пока нет')}
          text={t('Сертификат подлинности выдаётся автоматически, когда вы подтверждаете получение работы. Его можно проверить по QR-коду и передать вместе с работой.')}
        />
      }
    />
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.wall },
}));
