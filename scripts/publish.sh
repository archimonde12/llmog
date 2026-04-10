#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting deployment process..."

# 1. Verify current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  echo "❌ Error: Deployment must be performed on the 'main' or 'master' branch. (Current: $CURRENT_BRANCH)"
  exit 1
fi

# 2. Verify working directory is clean (no uncommitted changes)
if ! git diff-index --quiet HEAD --; then
  echo "❌ Error: You have uncommitted changes. Please commit or stash them before publishing."
  exit 1
fi

# 3. Run Build process
echo "🛠️ Running build process..."
npm run build || { echo "❌ Build failed!"; exit 1; }

# 4. Run Test suite
echo "🧪 Running test suite..."
npm test || { echo "❌ Tests failed! Aborting publication."; exit 1; }

# 5. Execute NPM Publication
echo "📦 Publishing to npm..."
# Using --access public to ensure accessibility for open-source users
npm publish --access public

echo "✅ Successfully published to npm!"