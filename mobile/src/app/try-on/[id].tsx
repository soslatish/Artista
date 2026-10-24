// «Примерить на стену»: работа в настоящем масштабе на фоне готового интерьера или фото своей стены.
// Масштаб: у готовых интерьеров он известен (диван 200 см и т. п.), для своего фото пользователь
// отмечает предмет известной ширины — дверь, лист А4.
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useMemo, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { errorText } from '@/api/client';
import { useArtwork } from '@/api/hooks';
import { pickPhotos } from '@/features/pick-photos';
import { useT } from '@/i18n';
import { notify } from '@/lib/confirm';
import { parseRubles } from '@/lib/format';
import { validId } from '@/lib/guard';
import { Button, Chip, ErrorState, Field, Loading, T } from '@/ui/primitives';
import { makeStyles, radius, space } from '@/ui/theme';

interface Room {
  key: string;
  label: string;
  source: number;
  width: number;
  height: number;
  pxPerCm: number; // в пикселях исходного изображения
  floorY: number; // линия пола в пикселях исходного изображения
}

// масштаб интерьеров задан при отрисовке (см. assets/rooms)
const rooms: Room[] = [
  { key: 'living', label: 'Гостиная', source: require('@/assets/rooms/living.jpg'), width: 1600, height: 1100, pxPerCm: 3.2, floorY: 860 },
  { key: 'bedroom', label: 'Спальня', source: require('@/assets/rooms/bedroom.jpg'), width: 1600, height: 1100, pxPerCm: 3.2, floorY: 860 },
  { key: 'office', label: 'Кабинет', source: require('@/assets/rooms/office.jpg'), width: 1600, height: 1100, pxPerCm: 3.2, floorY: 860 },
];

/** Центр работы по стандарту галерей — на высоте 150 см от пола. */
const EYE_LEVEL_CM = 150;

const references = [
  { label: 'Дверь — 80 см', cm: 80 },
  { label: 'Лист А4 — 30 см', cm: 29.7 },
  { label: 'Розетка — 8 см', cm: 8 },
];

interface Size {
  w: number;
  h: number;
}

export default function TryOnRoute() {
  const id = validId(useLocalSearchParams().id);
  const t = useT();
  if (!id) return <ErrorState text={t('Ссылка повреждена.')} />;
  return <TryOn id={id} />;
}

function TryOn({ id }: { id: string }) {
  const t = useT();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const q = useArtwork(id);
  const [roomKey, setRoomKey] = useState('living');
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [photoPxPerCm, setPhotoPxPerCm] = useState<number | null>(null);
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  const shotRef = useRef<ComponentRef<typeof View>>(null);

  const room = rooms.find((r) => r.key === roomKey) ?? rooms[0];

  // прямоугольник фона на экране (contentFit="contain")
  const bg = useMemo(() => {
    const iw = photo ? photo.width : room.width;
    const ih = photo ? photo.height : room.height;
    if (!stage.w || !stage.h || !iw || !ih) return null;
    const scale = Math.min(stage.w / iw, stage.h / ih);
    const w = iw * scale;
    const h = ih * scale;
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h, scale };
  }, [photo, room, stage]);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState text={errorText(q.error)} onRetry={() => q.refetch()} />;
  const a = q.data;

  const pxPerCm = photo ? photoPxPerCm : bg ? room.pxPerCm * bg.scale : null;
  const artW = pxPerCm ? a.width_cm * pxPerCm : 0;
  const artH = pxPerCm ? a.height_cm * pxPerCm : 0;
  const defaultCenter = bg && pxPerCm ? (photo ? { x: bg.x + bg.w / 2, y: bg.y + bg.h * 0.4 } : { x: bg.x + bg.w / 2, y: bg.y + room.floorY * bg.scale - EYE_LEVEL_CM * pxPerCm }) : null;

  const pickWall = async (source: 'library' | 'camera') => {
    const [asset] = await pickPhotos(source, 1);
    if (!asset) return;
    setPhoto({ uri: asset.uri, width: asset.width, height: asset.height });
    setPhotoPxPerCm(null);
    setCalibrating(true);
  };

  const share = async () => {
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.9 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: a.title });
    } catch {
      notify(t('Не получилось сохранить снимок'));
    }
  };

  const onLayout = (e: LayoutChangeEvent) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={styles.root}>
      <View ref={shotRef} collapsable={false} style={styles.stage} onLayout={onLayout}>
        <Image source={photo ? { uri: photo.uri } : room.source} style={styles.fill} contentFit="contain" />
        {calibrating && photo ? (
          <Calibrator onDone={(ppc) => (setPhotoPxPerCm(ppc), setCalibrating(false))} stageWidth={stage.w} />
        ) : defaultCenter && artW > 0 && a.images[0] ? (
          <DraggableArt key={`${roomKey}-${photo?.uri ?? ''}-${Math.round(artW)}`} uri={a.images[0]} width={artW} height={artH} center={defaultCenter} />
        ) : null}
      </View>

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={() => router.back()} style={styles.round} hitSlop={8}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.caption}>
          <T variant="smallStrong" color="#FFFFFF" numberOfLines={1}>
            {a.title}
          </T>
          <T variant="small" color="rgba(255,255,255,0.8)">
            {t('{w} × {h} см, в настоящем масштабе', { w: a.width_cm, h: a.height_cm })}
          </T>
        </View>
        {Platform.OS !== 'web' && !calibrating ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Поделиться снимком')} onPress={share} style={styles.round} hitSlop={8}>
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.round} />
        )}
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + space.md }]}>
        {!calibrating ? (
          <>
            <T variant="small" center>
              {photo ? t('Перетащите работу, чтобы выбрать место.') : t('Работа висит центром на высоте 150 см — как в галерее. Перетащите, чтобы подвинуть.')}
            </T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {rooms.map((r) => (
                <Chip key={r.key} label={t(r.label)} selected={!photo && roomKey === r.key} onPress={() => (setPhoto(null), setRoomKey(r.key))} />
              ))}
              <Chip label={t('Фото моей стены')} selected={!!photo} onPress={() => void pickWall('library')} />
              {Platform.OS !== 'web' ? <Chip label={t('Снять стену')} onPress={() => void pickWall('camera')} /> : null}
            </ScrollView>
            {photo ? <Button title={t('Изменить масштаб')} variant="ghost" onPress={() => setCalibrating(true)} /> : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

/** Работа, которую можно двигать пальцем; размер — строго по сантиметрам. */
function DraggableArt({ uri, width, height, center }: { uri: string; width: number; height: number; center: { x: number; y: number } }) {
  const styles = useStyles();
  const [pos, setPos] = useState({ x: center.x - width / 2, y: center.y - height / 2 });
  const drag = useRef({ x: 0, y: 0, pageX: 0, pageY: 0 });
  const onGrant = (e: GestureResponderEvent) => {
    drag.current = { x: pos.x, y: pos.y, pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY };
  };
  const onMove = (e: GestureResponderEvent) => {
    const d = drag.current;
    setPos({ x: d.x + e.nativeEvent.pageX - d.pageX, y: d.y + e.nativeEvent.pageY - d.pageY });
  };
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      style={[styles.art, { width, height, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <Image source={{ uri }} style={styles.fill} contentFit="cover" />
    </View>
  );
}

/** Калибровка: две отметки по краям известного предмета + его ширина. */
function Calibrator({ onDone, stageWidth }: { onDone: (pxPerCm: number) => void; stageWidth: number }) {
  const t = useT();
  const styles = useStyles();
  const [left, setLeft] = useState(stageWidth * 0.3);
  const [right, setRight] = useState(stageWidth * 0.7);
  const [cm, setCm] = useState('80');
  const value = parseRubles(cm) ? (parseRubles(cm) as number) / 100 : 0;
  const valid = value >= 2 && value <= 1000 && right - left > 20;
  return (
    <>
      <Marker x={left} onMove={(x) => setLeft(Math.max(8, Math.min(x, right - 20)))} />
      <Marker x={right} onMove={(x) => setRight(Math.min(stageWidth - 8, Math.max(x, left + 20)))} />
      <View pointerEvents="none" style={[styles.ruler, { left, width: right - left }]} />
      <View style={styles.calibrate}>
        <T variant="bodyStrong">{t('Отметьте предмет известной ширины')}</T>
        <T variant="small">{t('Передвиньте отметки к краям двери, листа бумаги или другого предмета и укажите его ширину.')}</T>
        <View style={styles.chipsWrap}>
          {references.map((r) => (
            <Chip key={r.label} label={t(r.label)} selected={value === r.cm} onPress={() => setCm(String(r.cm).replace('.', ','))} />
          ))}
        </View>
        <Field label={t('Ширина предмета, см')} value={cm} onChangeText={setCm} keyboardType="decimal-pad" />
        <Button title={t('Готово')} disabled={!valid} onPress={() => onDone((right - left) / value)} />
      </View>
    </>
  );
}

function Marker({ x, onMove }: { x: number; onMove: (x: number) => void }) {
  const styles = useStyles();
  const t = useT();
  const drag = useRef({ x: 0, pageX: 0 });
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        drag.current = { x, pageX: e.nativeEvent.pageX };
      }}
      onResponderMove={(e) => onMove(drag.current.x + e.nativeEvent.pageX - drag.current.pageX)}
      style={[styles.marker, { left: x - 22 }]}
      accessibilityRole="adjustable"
      accessibilityLabel={t('Отметка края предмета')}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onMove(x + (e.nativeEvent.actionName === 'increment' ? 4 : -4))}>
      <View style={styles.markerLine} />
      <View style={styles.markerKnob} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: '#111' },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: '#111' },
  fill: { width: '100%', height: '100%' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  caption: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: 6 },
  panel: { gap: space.sm, paddingTop: space.md, backgroundColor: c.wall, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: space.lg },
  chips: { gap: space.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  art: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: c.plaster,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  markerLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: c.gold },
  markerKnob: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.gold, borderWidth: 3, borderColor: '#FFFFFF' },
  ruler: { position: 'absolute', top: '45%', height: 2, backgroundColor: c.gold },
  calibrate: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, gap: space.sm, padding: space.lg, borderRadius: radius.sheet, backgroundColor: c.wall },
}));
