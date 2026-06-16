import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  TouchableOpacity, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { COLORS, RADIUS, SERVICE_CATEGORIES } from '../constants/theme';

export default function CreateServiceScreen() {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(SERVICE_CATEGORIES[1]);
  const [description, setDescription] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCats, setShowCats] = useState(false);

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setImages((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, 6));
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert('Ошибка', 'Заполните название и описание');
      return;
    }
    setLoading(true);
    try {
      const { data: service } = await api.post('/services/', {
        title: title.trim(),
        category,
        description: description.trim(),
        price_from: priceFrom ? parseFloat(priceFrom) : undefined,
        price_to: priceTo ? parseFloat(priceTo) : undefined,
        tags: tags.trim() || undefined,
      });

      if (images.length > 0) {
        const form = new FormData();
        images.forEach((uri, i) => {
          form.append('files', { uri, name: `img_${i}.jpg`, type: 'image/jpeg' } as any);
        });
        await api.post(`/services/${service.id}/images`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      Alert.alert('Готово!', 'Услуга создана', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Ошибка', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Создать услугу</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Input label="Название услуги" value={title} onChangeText={setTitle} placeholder="Роспись стен, портрет маслом..." />

          <Text style={styles.label}>Категория</Text>
          <TouchableOpacity onPress={() => setShowCats(!showCats)} style={styles.catSelector}>
            <Text style={styles.catSelectorText}>{category}</Text>
            <Ionicons name={showCats ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {showCats && (
            <View style={styles.catList}>
              {SERVICE_CATEGORIES.slice(1).map((cat) => (
                <TouchableOpacity key={cat} onPress={() => { setCategory(cat); setShowCats(false); }} style={styles.catOption}>
                  <Text style={[styles.catOptionText, cat === category && styles.catOptionActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Input
            label="Описание"
            value={description}
            onChangeText={setDescription}
            placeholder="Расскажите о своей услуге подробнее..."
            multiline
            numberOfLines={5}
            style={{ minHeight: 110, textAlignVertical: 'top' }}
          />

          <View style={styles.priceRow}>
            <View style={styles.priceFlex}>
              <Input label="Цена от (₽)" value={priceFrom} onChangeText={setPriceFrom} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={styles.priceFlex}>
              <Input label="Цена до (₽)" value={priceTo} onChangeText={setPriceTo} keyboardType="numeric" placeholder="0" />
            </View>
          </View>

          <Input label="Теги (через запятую)" value={tags} onChangeText={setTags} placeholder="живопись, акварель, портрет" />

          <Text style={styles.label}>Фотографии (до 6)</Text>
          <View style={styles.imageGrid}>
            {images.map((uri, i) => (
              <View key={i} style={styles.imageTile}>
                <Image source={{ uri }} style={styles.imageTileImg} />
                <TouchableOpacity
                  onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  style={styles.imageRemove}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.red} />
                </TouchableOpacity>
              </View>
            ))}
            {images.length < 6 && (
              <TouchableOpacity onPress={pickImages} style={styles.addImageBtn}>
                <Ionicons name="add" size={28} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          <Button title="Создать услугу" onPress={handleSubmit} loading={loading} style={styles.submitBtn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.white },
  content: { padding: 16, paddingBottom: 40 },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500', marginBottom: 6 },
  catSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.inputBg, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.inputBorder,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 6,
  },
  catSelectorText: { color: COLORS.white, fontSize: 15 },
  catList: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.inputBorder, marginBottom: 14, overflow: 'hidden',
  },
  catOption: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  catOptionText: { color: COLORS.textSecondary, fontSize: 14 },
  catOptionActive: { color: COLORS.orange, fontWeight: '700' },
  priceRow: { flexDirection: 'row', gap: 12 },
  priceFlex: { flex: 1 },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  imageTile: { width: 90, height: 90, borderRadius: RADIUS.md, overflow: 'visible' },
  imageTileImg: { width: 90, height: 90, borderRadius: RADIUS.md },
  imageRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.bg, borderRadius: 10 },
  addImageBtn: {
    width: 90, height: 90, borderRadius: RADIUS.md,
    backgroundColor: COLORS.inputBg, borderWidth: 1.5, borderColor: COLORS.inputBorder,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  submitBtn: { marginTop: 4 },
});
