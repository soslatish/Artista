import { Redirect, useLocalSearchParams } from 'expo-router';

const codePattern = /^ART-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Ссылка из QR сертификата открывает его в приложении. */
export default function CertificateLink() {
  const raw = useLocalSearchParams().code;
  const code = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (!codePattern.test(code)) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/certificate/[code]', params: { code } }} />;
}
