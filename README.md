# FlapWorld

A polished Flappy-Bird-style game built with Expo + React Native Reanimated v3,
using your real game art (bird, lamp-post obstacles, meadow background, coin).

## Assets

Your uploaded artwork is already in `assets/`, trimmed and sized for the game:

| File              | Role                                   |
|-------------------|-----------------------------------------|
| `background.png`  | Scrolling meadow/village backdrop       |
| `bird_1/2/3.png`  | 3-frame flap animation                  |
| `pipe_top.png`    | Hanging wall lamp — top obstacle        |
| `pipe_bottom.png` | Free-standing lamp post — bottom obstacle |
| `coin.png`        | Collectible coin                        |

> Note: your original "pipe" reference image actually contained **two** distinct
> lamp designs (a wall bracket and a floor post). Rather than force one image to
> serve as both the top and bottom obstacle, the code uses both real designs —
> `pipe_top.png` hangs from the ceiling, `pipe_bottom.png` rises from the ground.
> Swap either file for a new PNG at any time; nothing else needs to change.

## Run it locally

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (Android/iOS) to play on your own phone instantly.

## Build a real installable APK (no Android Studio needed)

This project builds in the cloud via Expo's own service:

```bash
npm install -g eas-cli
eas login              # free Expo account
eas build:configure
eas build --platform android --profile preview
```

When the build finishes, Expo gives you a direct download link to the `.apk`.
The free tier includes a limited number of builds per month — check
expo.dev/pricing for current limits before you run a lot of builds.

## Gameplay

- Tap / touch anywhere to flap.
- Fly through the gap between each lamp pair to score a point.
- Collect coins floating in the gaps for your coin counter.
- Hitting a lamp, the ceiling-floor, or the ground ends the run.
- High score is saved on-device between sessions (AsyncStorage).
