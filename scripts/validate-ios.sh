#!/bin/bash
#
# Validates that the iOS native code compiles successfully.
# Uses capper-expo (or any Expo app) as a test harness.
#
# Usage:
#   ./scripts/validate-ios.sh                          # uses default test app
#   ./scripts/validate-ios.sh /path/to/expo-app        # uses custom test app
#
# Run this BEFORE publishing to npm to catch Swift compile errors.

set -euo pipefail

# Fix CocoaPods UTF-8 encoding issue
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

SDK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_APP="${1:-/Users/czy/Desktop/capper/capper-expo}"

if [ ! -d "$TEST_APP" ]; then
  echo "Error: Test app not found at $TEST_APP"
  echo "Usage: $0 /path/to/expo-app"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "Error: npx not found. Install Node.js first."
  exit 1
fi

echo ""
echo "=== Datalyr iOS Build Validation ==="
echo "SDK:      $SDK_DIR"
echo "Test App: $TEST_APP"
echo ""

# Cleanup function to always restore test app state
cleanup() {
  echo "[5/5] Cleaning up..."
  cd "$TEST_APP"
  rm -rf ios android .expo 2>/dev/null || true
  git checkout -- package.json 2>/dev/null || true
  git checkout -- package-lock.json 2>/dev/null || true
  rm -f "/tmp/$TARBALL" 2>/dev/null || true
}
trap cleanup EXIT

# Step 1: Pack the SDK
echo "[1/5] Packing SDK..."
TARBALL=$(cd "$SDK_DIR" && npm pack --pack-destination /tmp 2>/dev/null | tail -1)
echo "       Created /tmp/$TARBALL"

# Step 2: Install packed SDK in test app
echo "[2/5] Installing SDK in test app..."
cd "$TEST_APP"
npm install "/tmp/$TARBALL" --legacy-peer-deps 2>&1 | tail -3

# Step 3: Generate iOS native project
echo "[3/5] Running expo prebuild (iOS)..."
npx expo prebuild --clean --platform ios 2>&1 | tail -10

# Step 4: Build for simulator (no signing needed)
echo "[4/5] Building iOS (this may take a few minutes)..."
WORKSPACE=$(ls -d ios/*.xcworkspace 2>/dev/null | head -1)

if [ -z "$WORKSPACE" ]; then
  echo "Error: No .xcworkspace found after prebuild. Check prebuild output above."
  exit 1
fi

SCHEME=$(basename "$WORKSPACE" .xcworkspace)

cd ios
xcodebuild build \
  -workspace "$(basename "$WORKSPACE")" \
  -scheme "$SCHEME" \
  -sdk iphonesimulator \
  -configuration Debug \
  -arch "$(uname -m)" \
  CODE_SIGNING_ALLOWED=NO \
  -quiet \
  2>&1

echo ""
echo "=== iOS build validation PASSED ==="
echo ""
