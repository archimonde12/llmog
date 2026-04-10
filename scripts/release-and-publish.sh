#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "--------------------------------------------------"
echo "🚀 Starting Release & Publish Workflow"
echo "--------------------------------------------------"

# 1. Prompt user for version bump type
echo "Select version bump type (patch, minor, or major):"
read VERSION_TYPE

# Validate input
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "❌ Error: Invalid version type '$VERSION_TYPE'. Must be 'patch', 'release', or 'major'."
  exit 1
fi

# 2. Execute npm versioning
# This command updates package.json, creates a git commit, and creates a git tag.
echo "🆙 Bumping version ($VERSION_TYPE)..."
npm version $VERSION_TYPE -m "chore: bump version to %s [skip ci]"

# 3. Trigger the publication script
# We call the existing publish.sh to handle build, test, and npm publish tasks.
echo "📦 Triggering publication script..."
./scripts/publish.sh

# 4. Push changes and tags to remote repository
echo "📤 Pushing changes and tags to origin..."
git push origin main
git push origin --tags

echo "--------------------------------------------------"
echo "🎉 Release Complete!"
echo "--------------------------------------------------"