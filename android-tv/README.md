# Reddate for Android TV

A thin Android TV app around Reddate's TV page (`/?tv=1`, see `public/tv.js`):

- **`MainActivity`** hosts the page in a full-screen WebView. The remote's D-pad arrives in the page as
  arrow keys and Enter; **Back** is forwarded to the page so it can step back through its own screens.
- **`PlayerActivity`** is a native ExoPlayer (Media3) screen that plays what the TV's hardware can decode
  (MKV, HEVC, Dolby Digital…). The page keeps the room in sync: it sends play/pause/seek in, and the app
  reports what the viewer did with the remote back out.
- **`NativeBridge`** is what the page can call (`window.ReddateNative`): device name, exit, open/command the player.

## Build and run

Needs a JDK 17 and the Android SDK (platform 34, build-tools 34.0.0).

```bash
cd android-tv
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
```

Debug builds load `http://10.0.2.2:3090/?tv=1` (the Android emulator's address for your computer) so you can
run the Reddate server locally (`npm start`). To point at another address (for example a real TV on your Wi-Fi):

```bash
./gradlew installDebug -PstartUrl=http://192.168.1.20:3090/?tv=1
```

Release builds load `https://reddate.xyz/?tv=1`.

## Install on a real TV

Turn on *Developer options → Network debugging* on the TV, then:

```bash
adb connect <tv-ip>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Never commit a signing keystore or `local.properties`.
