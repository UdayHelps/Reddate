#!/bin/sh
# Build the signed release APK, copy it where the site serves it, and write the version file the app's
# "Update" button reads. Bump versionCode/versionName in app/build.gradle.kts first.
set -e
cd "$(dirname "$0")"
./gradlew assembleRelease -q
APK=app/build/outputs/apk/release/app-release.apk
AAPT=$(ls "$ANDROID_HOME"/build-tools/*/aapt | tail -1)
CODE=$($AAPT dump badging "$APK" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
NAME=$($AAPT dump badging "$APK" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
cp "$APK" ../downloads/reddate-tv.apk
SHA=$(shasum -a 256 ../downloads/reddate-tv.apk | cut -c1-64)
SIZE=$(stat -f %z ../downloads/reddate-tv.apk 2>/dev/null || stat -c %s ../downloads/reddate-tv.apk)
NOTES=${1:-"Improvements and fixes."}
# notes: separate bullet points with | ; quotes are escaped here
ESC=$(printf '%s' "$NOTES" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{\n "versionCode": %s,\n "versionName": "%s",\n "size": %s,\n "sha256": "%s",\n "notes": "%s"\n}\n' "$CODE" "$NAME" "$SIZE" "$SHA" "$ESC" > ../downloads/version.json
echo "Released $NAME ($CODE), $SIZE bytes, sha256 $SHA"
# The app file is published as a GitHub Release asset: the site's /get and the app's Update button use
# https://github.com/<repo>/releases/latest/download/reddate-tv.apk, so downloads never touch our server's bandwidth.
# Needs the GitHub CLI signed in to the account that owns the repo (gh auth login).
if command -v gh >/dev/null 2>&1; then
  REPO=${REDDATE_REPO:-UdayHelps/Reddate}
  gh release create "v$NAME" ../downloads/reddate-tv.apk --repo "$REPO" --title "Reddate TV $NAME" --notes "$NOTES" \
    && echo "Published release v$NAME on $REPO" || echo "Could not publish the GitHub release (is gh signed in? does v$NAME already exist?)"
else
  echo "Install the GitHub CLI (brew install gh) to publish the APK as a release."
fi
echo "Next: update the checksum on tv-site/download.html, commit, push."
