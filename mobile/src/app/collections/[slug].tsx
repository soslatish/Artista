import { Redirect, useLocalSearchParams } from 'expo-router';

const slugPattern = /^[a-z0-9-]{1,64}$/;

/** Ссылка на подборку с сайта. */
export default function CollectionLink() {
  const raw = useLocalSearchParams().slug;
  if (typeof raw !== 'string' || !slugPattern.test(raw)) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/collection/[slug]', params: { slug: raw } }} />;
}
