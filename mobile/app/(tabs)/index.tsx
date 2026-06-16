import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../services/api';
import { Service } from '../../types';
import { ServiceCard } from '../../components/ServiceCard';
import { COLORS, RADIUS, SERVICE_CATEGORIES } from '../../constants/theme';
import { useAuthStore } from '../../store/auth';

export default function ServicesScreen() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Все');
  const { user } = useAuthStore();

  const fetchServices = useCallback(async () => {
    try {
      const params: any = {};
      if (category !== 'Все') params.category = category;
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get('/services/', { params });
      setServices(data);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category, search]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchServices();
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Услуги</Text>
        {user?.role === 'artist' && (
          <TouchableOpacity onPress={() => router.push('/create-service')} style={styles.addBtn}>
            <Ionicons name="add" size={22} color={COLORS.white} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={COLORS.textMuted} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск услуг..."
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={fetchServices}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
        style={styles.categoriesScroll}
      >
        {SERVICE_CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            onPress={() => setCategory(cat)}
            style={[styles.catChip, category === cat && styles.catChipActive]}
          >
            <Text style={[styles.catText, category === cat && styles.catTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={COLORS.orange} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={services}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => <ServiceCard service={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.orange} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="brush-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Услуги не найдены</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, fontSize: 26, fontWeight: '900', color: COLORS.white },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: COLORS.white, fontSize: 15, paddingVertical: 11 },
  categoriesScroll: { maxHeight: 44, marginBottom: 8 },
  categories: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1, borderColor: COLORS.inputBorder,
  },
  catChipActive: { backgroundColor: COLORS.orange, borderColor: COLORS.orange },
  catText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  catTextActive: { color: COLORS.white, fontWeight: '700' },
  list: { padding: 16 },
  empty: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { color: COLORS.textSecondary, fontSize: 16 },
});
