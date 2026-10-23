// Полноэкранный просмотр фото работы: листание, щипок для масштаба, двойной тап.
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, T } from './primitives';
import { colors, space } from './theme';

const MAX_SCALE = 5;

function ZoomableImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    saved.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1.01) reset();
    });

  // панорамирование только в увеличенном виде, иначе свайп листает фото
  const pan = Gesture.Pan()
    .averageTouches(true)
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (saved.value > 1) state.activate();
      else state.fail();
    })
    .onUpdate((e) => {
      tx.value = savedX.value + e.translationX;
      ty.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = tx.value;
      savedY.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (saved.value > 1) reset();
      else {
        scale.value = withTiming(2.5);
        saved.value = 2.5;
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

interface ViewerProps {
  images: string[];
  index: number;
  visible: boolean;
  title: string;
  onClose: () => void;
}

export function ImageViewer({ images, index, visible, title, onClose }: ViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <GestureHandlerRootView style={styles.root}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(u, i) => `${i}-${u}`}
          onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <ZoomableImage uri={item} width={width} height={height * 0.8} />
            </View>
          )}
        />
        <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <T variant="artTitleSmall" color={colors.onDark} numberOfLines={1} style={styles.title}>
            {title}
          </T>
          <IconButton icon="close" label="Закрыть просмотр" color={colors.onDark} size={28} onPress={onClose} />
        </View>
        {images.length > 1 ? (
          <T variant="small" color={colors.onDarkMuted} center style={[styles.counter, { bottom: insets.bottom + space.lg }]}>
            {current + 1} из {images.length}
          </T>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.md },
  title: { flex: 1 },
  counter: { position: 'absolute', left: 0, right: 0 },
});
