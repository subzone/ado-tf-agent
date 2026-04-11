#!/usr/bin/env node
/**
 * Syncs version across all files from git tag or package version.
 * 
 * Usage:
 *   node scripts/sync-version.js [--from-git] [--version=x.y.z]
 * 
 * Options:
 *   --from-git         Use latest git tag as source of truth
 *   --version=x.y.z    Use specified version (overrides git tag)
 *   --dry-run          Show what would change without modifying files
 * 
 * Updates:
 *   - vss-extension.json (version field)
 *   - tasks/Terraform/task.json (version.Major/Minor/Patch)
 *   - tasks/Terraform/package.json (version field)
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const fromGit = args.includes('--from-git');
const dryRun = args.includes('--dry-run');
const versionArg = args.find(a => a.startsWith('--version='));
const specifiedVersion = versionArg ? versionArg.split('=')[1] : null;

function getGitVersion() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    // Remove 'v' prefix if present
    return tag.replace(/^v/, '');
  } catch (err) {
    console.error('Warning: No git tags found. Use --version=x.y.z to specify version.');
    return null;
  }
}

function parseVersion(versionStr) {
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${versionStr}. Expected: x.y.z`);
  }
  return {
    full: versionStr,
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function updateJsonFile(filePath, updateFn) {
  const fullPath = path.join(__dirname, '..', filePath);
  const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const oldContent = JSON.stringify(content, null, 2);
  
  updateFn(content);
  
  const newContent = JSON.stringify(content, null, 2) + '\n';
  
  if (oldContent === newContent.trim()) {
    console.log(`✓ ${filePath} (already up to date)`);
    return false;
  }
  
  if (!dryRun) {
    fs.writeFileSync(fullPath, newContent, 'utf8');
    console.log(`✓ ${filePath} (updated)`);
  } else {
    console.log(`✓ ${filePath} (would update)`);
  }
  return true;
}

function main() {
  console.log('=== Version Synchronization ===\n');
  
  // Determine source version
  let sourceVersion;
  if (specifiedVersion) {
    sourceVersion = specifiedVersion;
    console.log(`Source: --version=${sourceVersion}`);
  } else if (fromGit) {
    sourceVersion = getGitVersion();
    if (!sourceVersion) {
      process.exit(1);
    }
    console.log(`Source: git tag (${sourceVersion})`);
  } else {
    // Default: read from vss-extension.json
    const extManifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'vss-extension.json'), 'utf8')
    );
    sourceVersion = extManifest.version;
    console.log(`Source: vss-extension.json (${sourceVersion})`);
  }
  
  const version = parseVersion(sourceVersion);
  console.log(`Target version: ${version.full}\n`);
  
  if (dryRun) {
    console.log('DRY RUN — no files will be modified\n');
  }
  
  let changed = 0;
  
  // Update vss-extension.json
  if (updateJsonFile('vss-extension.json', (manifest) => {
    manifest.version = version.full;
  })) {
    changed++;
  }
  
  // Update tasks/Terraform/task.json
  if (updateJsonFile('tasks/Terraform/task.json', (task) => {
    task.version = {
      Major: version.major,
      Minor: version.minor,
      Patch: version.patch,
    };
  })) {
    changed++;
  }
  
  // Update tasks/Terraform/package.json
  if (updateJsonFile('tasks/Terraform/package.json', (pkg) => {
    pkg.version = version.full;
  })) {
    changed++;
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`${changed} file(s) ${dryRun ? 'would be' : 'were'} updated`);
  
  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes');
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
