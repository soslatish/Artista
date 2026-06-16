import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';
import { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, role: 'artist' | 'customer') => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  loadFromStorage: async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (token) {
        const { data } = await api.get('/users/me');
        set({ user: data, token, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      await SecureStore.deleteItemAsync('access_token');
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    await SecureStore.setItemAsync('access_token', data.access_token);
    set({ user: data.user, token: data.access_token });
  },

  register: async (email, password, name, role) => {
    const { data } = await api.post('/auth/register', { email, password, name, role });
    await SecureStore.setItemAsync('access_token', data.access_token);
    set({ user: data.user, token: data.access_token });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('access_token');
    set({ user: null, token: null });
  },

  updateUser: (user) => set({ user }),
}));
