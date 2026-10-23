// Последний зарегистрированный Expo push-токен этого устройства (нужен при выходе).
let token: string | null = null;

export function setRegisteredPushToken(t: string | null): void {
  token = t;
}

export function registeredPushToken(): string | null {
  return token;
}
