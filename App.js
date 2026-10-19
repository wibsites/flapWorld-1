/**
 * FlapWorld — Expo / React Native
 * A polished Flappy-Bird-style game using real PNG sprites and
 * react-native-reanimated v3 for buttery-smooth, UI-thread-driven physics.
 *
 * Assets expected in ./assets :
 *   background.png              parallax scene
 *   bird_1.png bird_2.png bird_3.png   flap animation frames
 *   pipe_top.png                 hanging lamp (top obstacle)
 *   pipe_bottom.png              lamp post (bottom obstacle)
 *   coin.png                     collectible coin
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// ----------------------------------------------------------------------------
// Assets
// ----------------------------------------------------------------------------
const BG_IMG = require('./assets/background.png');
const BIRD_FRAMES = [
  require('./assets/bird_1.png'),
  require('./assets/bird_2.png'),
  require('./assets/bird_3.png'),
];
const PIPE_TOP_IMG = require('./assets/pipe_top.png');
const PIPE_BOTTOM_IMG = require('./assets/pipe_bottom.png');
const COIN_IMG = require('./assets/coin.png');

// ----------------------------------------------------------------------------
// Layout / screen
// ----------------------------------------------------------------------------
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ----------------------------------------------------------------------------
// Tunable game constants
// ----------------------------------------------------------------------------
const GRAVITY = 1700;           // px / s^2
const FLAP_VELOCITY = -480;     // px / s (negative = upward)
const MAX_FALL_SPEED = 900;     // terminal velocity clamp
const PIPE_SPEED = 165;         // px / s, world scroll speed
const PIPE_GAP = 190;           // vertical gap the bird must fly through
const PIPE_WIDTH = 68;          // hit-box width used for both lamp sprites
const PIPE_MIN_TOP = 90;        // smallest allowed top-obstacle height
const PIPE_MARGIN_BOTTOM = 140; // keeps bottom obstacle from touching the floor
const SPAWN_SPACING = 260;      // horizontal distance between pipe pairs
const POOL_SIZE = 4;            // recycled pipe/coin slots (object pooling)

const BIRD_X = SCREEN_W * 0.28; // fixed horizontal position of the bird
const BIRD_W = 64;
const BIRD_H = 70;
const BIRD_HITBOX_RADIUS = 24;  // circular collision radius (more forgiving/accurate than full box)

const COIN_SIZE = 34;
const COIN_HITBOX_RADIUS = 20;

const GROUND_Y = SCREEN_H;      // bird dying off the bottom edge counts as ground hit
const CEILING_Y = 0;

const HIGH_SCORE_KEY = '@flapworld_high_score';

const GAME_STATE = { READY: 0, PLAYING: 1, GAME_OVER: 2 };

function randomGapCenter() {
  'worklet';
  const minCenter = PIPE_MIN_TOP + PIPE_GAP / 2;
  const maxCenter = SCREEN_H - PIPE_MARGIN_BOTTOM - PIPE_GAP / 2;
  return minCenter + Math.random() * Math.max(10, maxCenter - minCenter);
}

// ----------------------------------------------------------------------------
// Root component
// ----------------------------------------------------------------------------
export default function App() {
  return (
    <SafeAreaProvider>
      <GameScreen />
    </SafeAreaProvider>
  );
}

function GameScreen() {
  const insets = useSafeAreaInsets();

  // ---------------- React (JS-thread) state: drives UI only ----------------
  const [gameState, setGameState] = useState(GAME_STATE.READY);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [birdFrame, setBirdFrame] = useState(0);

  // ---------------- Reanimated shared values: drive physics / rendering ----
  const gameActive = useSharedValue(0); // mirrors gameState so the UI-thread loop can read it
  const birdY = useSharedValue(SCREEN_H / 2);
  const birdVelocity = useSharedValue(0);
  const birdRotation = useSharedValue(0);
  const bgOffset = useSharedValue(0);

  // Object pools (fixed-size, recycled — avoids GC churn from constantly creating/destroying
  // pipe & coin objects). POOL_SIZE is a fixed constant, so these hook calls are unrolled
  // explicitly rather than looped, keeping them fully rules-of-hooks compliant.
  const pipeX0 = useSharedValue(SCREEN_W + 9999);
  const pipeX1 = useSharedValue(SCREEN_W + 9999);
  const pipeX2 = useSharedValue(SCREEN_W + 9999);
  const pipeX3 = useSharedValue(SCREEN_W + 9999);
  const pipeX = [pipeX0, pipeX1, pipeX2, pipeX3];

  const pipeGapY0 = useSharedValue(SCREEN_H / 2);
  const pipeGapY1 = useSharedValue(SCREEN_H / 2);
  const pipeGapY2 = useSharedValue(SCREEN_H / 2);
  const pipeGapY3 = useSharedValue(SCREEN_H / 2);
  const pipeGapY = [pipeGapY0, pipeGapY1, pipeGapY2, pipeGapY3];

  const pipeScored0 = useSharedValue(0);
  const pipeScored1 = useSharedValue(0);
  const pipeScored2 = useSharedValue(0);
  const pipeScored3 = useSharedValue(0);
  const pipeScored = [pipeScored0, pipeScored1, pipeScored2, pipeScored3];

  const coinX0 = useSharedValue(SCREEN_W + 9999);
  const coinX1 = useSharedValue(SCREEN_W + 9999);
  const coinX2 = useSharedValue(SCREEN_W + 9999);
  const coinX3 = useSharedValue(SCREEN_W + 9999);
  const coinX = [coinX0, coinX1, coinX2, coinX3];

  const coinTaken0 = useSharedValue(1);
  const coinTaken1 = useSharedValue(1);
  const coinTaken2 = useSharedValue(1);
  const coinTaken3 = useSharedValue(1);
  const coinTaken = [coinTaken0, coinTaken1, coinTaken2, coinTaken3];

  // ---------------- Load persisted high score --------------------------------
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(HIGH_SCORE_KEY);
        if (stored) setHighScore(parseInt(stored, 10) || 0);
      } catch (e) {
        // ignore — storage may be unavailable; game still works this session
      }
    })();
  }, []);

  // ---------------- Bird flap-frame animation (visual only, JS thread) -------
  useEffect(() => {
    if (gameState !== GAME_STATE.PLAYING) return;
    const id = setInterval(() => {
      setBirdFrame((f) => (f + 1) % BIRD_FRAMES.length);
    }, 110);
    return () => clearInterval(id);
  }, [gameState]);

  // ---------------- JS-thread callbacks invoked from the UI-thread loop ------
  const incrementScore = useCallback(() => {
    setScore((s) => s + 1);
  }, []);

  const incrementCoins = useCallback(() => {
    setCoins((c) => c + 1);
  }, []);

  const handleGameOver = useCallback(() => {
    setGameState((prev) => {
      if (prev !== GAME_STATE.PLAYING) return prev;
      return GAME_STATE.GAME_OVER;
    });
  }, []);

  useEffect(() => {
    if (gameState === GAME_STATE.GAME_OVER) {
      gameActive.value = 0;
      setScore((currentScore) => {
        setHighScore((prevHigh) => {
          const newHigh = Math.max(prevHigh, currentScore);
          if (newHigh !== prevHigh) {
            AsyncStorage.setItem(HIGH_SCORE_KEY, String(newHigh)).catch(() => {});
          }
          return newHigh;
        });
        return currentScore;
      });
    }
  }, [gameState]);

  // ---------------- Reset pools / physics for a fresh run ---------------------
  const resetWorld = useCallback(() => {
    birdY.value = SCREEN_H / 2;
    birdVelocity.value = 0;
    birdRotation.value = 0;
    bgOffset.value = 0;

    for (let i = 0; i < POOL_SIZE; i++) {
      const spawnX = SCREEN_W + 60 + i * SPAWN_SPACING;
      pipeX[i].value = spawnX;
      pipeGapY[i].value = randomGapCenter();
      pipeScored[i].value = 0;
      coinX[i].value = spawnX;
      coinTaken[i].value = 0;
    }
    setScore(0);
    setCoins(0);
    setBirdFrame(0);
  }, []);

  const startGame = useCallback(() => {
    resetWorld();
    gameActive.value = 1;
    setGameState(GAME_STATE.PLAYING);
  }, [resetWorld]);

  const handlePress = useCallback(() => {
    if (gameState === GAME_STATE.READY) {
      startGame();
      birdVelocity.value = FLAP_VELOCITY;
    } else if (gameState === GAME_STATE.PLAYING) {
      birdVelocity.value = FLAP_VELOCITY;
    }
    // GAME_OVER taps are ignored here — only the Restart button restarts,
    // so an accidental extra tap after dying doesn't instantly relaunch.
  }, [gameState, startGame]);

  // ---------------- Core physics / collision loop — runs on the UI thread ----
  useFrameCallback((frame) => {
    'worklet';
    if (gameActive.value !== 1) return;

    const dt = Math.min((frame.timeSincePreviousFrame ?? 16.7) / 1000, 1 / 30);

    // -- bird physics --
    birdVelocity.value = Math.min(birdVelocity.value + GRAVITY * dt, MAX_FALL_SPEED);
    birdY.value += birdVelocity.value * dt;
    birdRotation.value = Math.max(-28, Math.min(85, birdVelocity.value / 8));

    if (birdY.value - BIRD_HITBOX_RADIUS < CEILING_Y) {
      birdY.value = CEILING_Y + BIRD_HITBOX_RADIUS;
      birdVelocity.value = 0;
    }
    if (birdY.value + BIRD_HITBOX_RADIUS > GROUND_Y) {
      birdY.value = GROUND_Y - BIRD_HITBOX_RADIUS;
      gameActive.value = 0; // stop simulating immediately, don't wait for React state
      runOnJS(handleGameOver)();
      return;
    }

    // -- background parallax --
    bgOffset.value -= PIPE_SPEED * 0.35 * dt;

    // -- pipes: move, recycle, score, collide --
    const birdLeft = BIRD_X - BIRD_HITBOX_RADIUS;
    const birdRight = BIRD_X + BIRD_HITBOX_RADIUS;
    const birdTop = birdY.value - BIRD_HITBOX_RADIUS;
    const birdBottom = birdY.value + BIRD_HITBOX_RADIUS;

    let furthestX = -Infinity;
    for (let i = 0; i < POOL_SIZE; i++) {
      pipeX[i].value -= PIPE_SPEED * dt;
      if (pipeX[i].value > furthestX) furthestX = pipeX[i].value;
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      if (pipeX[i].value < -PIPE_WIDTH - 10) {
        pipeX[i].value = furthestX + SPAWN_SPACING;
        pipeGapY[i].value = randomGapCenter();
        pipeScored[i].value = 0;
        furthestX = pipeX[i].value;
      }

      const pLeft = pipeX[i].value;
      const pRight = pLeft + PIPE_WIDTH;
      const gapTop = pipeGapY[i].value - PIPE_GAP / 2;
      const gapBottom = pipeGapY[i].value + PIPE_GAP / 2;

      if (pipeScored[i].value === 0 && pRight < birdLeft) {
        pipeScored[i].value = 1;
        runOnJS(incrementScore)();
      }

      const overlapsX = birdRight > pLeft && birdLeft < pRight;
      if (overlapsX && (birdTop < gapTop || birdBottom > gapBottom)) {
        gameActive.value = 0; // stop simulating immediately, don't wait for React state
        runOnJS(handleGameOver)();
        return;
      }
    }

    // -- coins: move alongside their pipe, re-arm when recycled, collect --
    for (let i = 0; i < POOL_SIZE; i++) {
      coinX[i].value = pipeX[i].value + PIPE_WIDTH / 2 - COIN_SIZE / 2;
      // A pipe's "scored" flag is reset to 0 the instant it recycles (see loop above).
      // We use that same moment to re-arm this slot's coin if it had been collected.
      if (coinTaken[i].value === 1 && pipeScored[i].value === 0) {
        coinTaken[i].value = 0;
      }
      if (coinTaken[i].value === 0) {
        const cx = coinX[i].value + COIN_SIZE / 2;
        const cy = pipeGapY[i].value;
        const dx = cx - BIRD_X;
        const dy = cy - birdY.value;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < COIN_HITBOX_RADIUS + BIRD_HITBOX_RADIUS) {
          coinTaken[i].value = 1;
          runOnJS(incrementCoins)();
        }
      }
    }
  }, true);

  // ---------------- Animated styles -------------------------------------------
  const birdStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: BIRD_X - BIRD_W / 2,
    top: birdY.value - BIRD_H / 2,
    width: BIRD_W,
    height: BIRD_H,
    transform: [{ rotate: `${birdRotation.value}deg` }],
  }));

  const bgWidth = Math.max(SCREEN_W * 1.6, 600);
  const bgStyleA = useAnimatedStyle(() => {
    const x = ((bgOffset.value % bgWidth) + bgWidth) % bgWidth;
    return { position: 'absolute', left: -x, top: 0, width: bgWidth, height: SCREEN_H };
  });
  const bgStyleB = useAnimatedStyle(() => {
    const x = ((bgOffset.value % bgWidth) + bgWidth) % bgWidth;
    return { position: 'absolute', left: bgWidth - x, top: 0, width: bgWidth, height: SCREEN_H };
  });

  return (
    <Pressable style={styles.flex} onPress={handlePress}>
      <StatusBar hidden />
      <View style={styles.flex}>
        {/* Parallax background, two tiles wrapping seamlessly */}
        <Animated.Image source={BG_IMG} style={bgStyleA} resizeMode="cover" />
        <Animated.Image source={BG_IMG} style={bgStyleB} resizeMode="cover" />

        {/* Pipes (lamp posts) */}
        {Array.from({ length: POOL_SIZE }).map((_, i) => (
          <PipePair
            key={i}
            index={i}
            pipeX={pipeX[i]}
            gapY={pipeGapY[i]}
          />
        ))}

        {/* Coins */}
        {Array.from({ length: POOL_SIZE }).map((_, i) => (
          <Coin key={i} coinX={coinX[i]} gapY={pipeGapY[i]} taken={coinTaken[i]} />
        ))}

        {/* Bird */}
        <Animated.Image source={BIRD_FRAMES[birdFrame]} style={birdStyle} resizeMode="contain" />

        {/* HUD */}
        <View style={[styles.hud, { paddingTop: insets.top + 12 }]} pointerEvents="none">
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>SCORE</Text>
            <Text style={styles.pillValue}>{score}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>COINS</Text>
            <Text style={styles.pillValue}>{coins}</Text>
          </View>
        </View>

        {gameState === GAME_STATE.READY && (
          <View style={styles.center} pointerEvents="box-none">
            <View style={styles.card}>
              <Text style={styles.title}>FlapWorld</Text>
              <Text style={styles.subtitle}>Tap anywhere to fly</Text>
              <Pressable style={styles.button} onPress={handlePress}>
                <Text style={styles.buttonText}>Tap to Start</Text>
              </Pressable>
            </View>
          </View>
        )}

        {gameState === GAME_STATE.GAME_OVER && (
          <View style={styles.center} pointerEvents="box-none">
            <View style={styles.card}>
              <Text style={styles.title}>Game Over</Text>
              <View style={styles.statsRow}>
                <Stat label="SCORE" value={score} />
                <Stat label="BEST" value={highScore} />
                <Stat label="COINS" value={coins} />
              </View>
              <Pressable style={styles.button} onPress={startGame}>
                <Text style={styles.buttonText}>Restart</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PipePair({ pipeX, gapY }) {
  const topStyle = useAnimatedStyle(() => {
    const height = Math.max(0, gapY.value - PIPE_GAP / 2);
    return {
      position: 'absolute',
      left: pipeX.value,
      top: 0,
      width: PIPE_WIDTH,
      height,
    };
  });
  const bottomStyle = useAnimatedStyle(() => {
    const top = gapY.value + PIPE_GAP / 2;
    const height = Math.max(0, SCREEN_H - top);
    return {
      position: 'absolute',
      left: pipeX.value,
      top,
      width: PIPE_WIDTH,
      height,
    };
  });
  return (
    <>
      <Animated.Image source={PIPE_TOP_IMG} style={topStyle} resizeMode="stretch" />
      <Animated.Image source={PIPE_BOTTOM_IMG} style={bottomStyle} resizeMode="stretch" />
    </>
  );
}

function Coin({ coinX, gapY, taken }) {
  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: coinX.value,
    top: gapY.value - COIN_SIZE / 2,
    width: COIN_SIZE,
    height: COIN_SIZE,
    opacity: taken.value === 1 ? 0 : 1,
    transform: [{ scale: taken.value === 1 ? 0 : 1 }],
  }));
  return <Animated.Image source={COIN_IMG} style={style} resizeMode="contain" />;
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#8ad4ff', overflow: 'hidden' },
  hud: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  pill: {
    backgroundColor: 'rgba(20,24,30,0.55)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  pillLabel: { color: '#fff', fontSize: 11, fontWeight: '700', opacity: 0.8, letterSpacing: 0.5 },
  pillValue: { color: '#fff', fontSize: 22, fontWeight: '800' },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(20,24,30,0.6)',
    borderRadius: 26,
    paddingVertical: 30,
    paddingHorizontal: 34,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  subtitle: { color: '#fff', opacity: 0.85, marginBottom: 18, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 26, marginVertical: 16 },
  stat: { alignItems: 'center', marginHorizontal: 10 },
  statValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  statLabel: { color: '#fff', opacity: 0.75, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  button: {
    backgroundColor: '#ffd23f',
    paddingVertical: 14,
    paddingHorizontal: 38,
    borderRadius: 999,
    marginTop: 6,
    borderBottomWidth: 4,
    borderBottomColor: '#b9780f',
  },
  buttonText: { color: '#4a2b00', fontWeight: '800', fontSize: 16 },
});
