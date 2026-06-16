import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Change this to your backend IP when testing on a physical device
export const API_BASE_URL = 'http://192.168.1.100:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.detail || 'Network error';
    return Promise.reject(new Error(msg));
  }
);

export default api;
