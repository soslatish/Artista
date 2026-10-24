jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
  };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
  Stack: { Screen: () => null },
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }) => require('react').createElement(Text, { accessibilityElementsHidden: true }, `icon:${name}`);
  return { Ionicons: Icon };
});
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'ru' }]) }));
jest.mock('expo-print', () => ({
  printAsync: jest.fn(async () => undefined),
  printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/cert.pdf' })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
