// Подтверждение действия: системный Alert на устройстве, window.confirm в веб-превью.
import { Alert, Platform } from 'react-native';

export function confirmAction(title: string, message: string, onConfirm: () => void, opts: { confirmText?: string; destructive?: boolean } = {}): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: opts.confirmText ?? 'Да', style: opts.destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export interface Choice {
  label: string;
  onPress: () => void;
}

/** Выбор из нескольких вариантов; в вебе — первый вариант после подтверждения. */
export function chooseAction(title: string, message: string, choices: Choice[]): void {
  if (Platform.OS === 'web') {
    const first = choices[0];
    if (first && globalThis.confirm?.(`${title}\n\n${first.label}?`)) first.onPress();
    return;
  }
  Alert.alert(title, message, [{ text: 'Отмена', style: 'cancel' }, ...choices.map((c) => ({ text: c.label, onPress: c.onPress }))]);
}

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
