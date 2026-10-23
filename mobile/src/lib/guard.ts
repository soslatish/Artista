// Проверка параметров маршрутов и доступа.
import { router } from 'expo-router';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Параметр маршрута из диплинка — недоверенная строка. */
export function validId(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

/** Если пользователь не вошёл — открывает вход и возвращает false. */
export function requireAuth(isSignedIn: boolean): boolean {
  if (!isSignedIn) {
    router.push('/login');
    return false;
  }
  return true;
}
