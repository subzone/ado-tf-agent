# Version Management

This project uses automated version synchronization to keep all version numbers consistent across:
- Extension manifest (`vss-extension.json`)
- Pipeline task definition (`tasks/Terraform/task.json`)
- Task package (`tasks/Terraform/package.json`)

## Version Source of Truth

The **git tag** is the single source of truth for versioning. When you create a new release:

1. Tag the release in git: `git tag v0.2.0`
2. Push the tag: `git push origin v0.2.0`
3. The GitHub Actions workflow will automatically sync versions and publish

## Manual Version Sync

Use the provided npm scripts:

```bash
# Sync from latest git tag (recommended)
npm run version:from-git

# Set a specific version
node scripts/sync-version.js --version=1.0.0

# Check what would change without modifying files
npm run version:check

# Or for git tag check in dry-run mode
node scripts/sync-version.js --from-git --dry-run
```

## GitHub Actions Integration

The `.github/workflows/extension.yml` workflow automatically:
1. Reads the latest git tag (e.g., `v0.2.0`)
2. Syncs all version files before building
3. Builds and publishes the extension with the correct version

## Creating a New Release

```bash
# 1. Commit your changes
git add .
git commit -m "feat: add new feature"

# 2. Create and push a version tag
git tag v0.2.0
git push origin v0.2.0

# 3. GitHub Actions will:
#    - Sync versions to 0.2.0
#    - Build the extension
#    - Publish to the marketplace
```

## Version Format

Use semantic versioning: `MAJOR.MINOR.PATCH`
- Git tags: `v0.1.8` (with 'v' prefix)
- Files: `0.1.8` (without 'v' prefix)

The sync script automatically strips the 'v' prefix when updating files.

## Troubleshooting

### "No git tags found"
Create your first tag:
```bash
git tag v0.1.0
git push origin v0.1.0
```

### Versions are out of sync
Run the sync command manually:
```bash
npm run version:from-git
```

### Need to set version without a tag
Use the `--version` flag:
```bash
node scripts/sync-version.js --version=1.0.5
```
