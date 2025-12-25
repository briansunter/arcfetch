# npm Publishing Setup

This document explains how to set up automated npm publishing with GitHub Actions using Bun and OIDC (Trusted Publishing).

## Overview

The publish workflow:
- Triggers on version tags (e.g., `v3.0.1`)
- Uses Bun for install, lint, typecheck, and test
- Uses `bunx npm@11.5.1 publish --provenance --access public` for publishing
- Emits provenance attestations for package integrity
- Supports OIDC Trusted Publishing (no long-lived tokens required)

## Prerequisites

### 1. Package Configuration

Your `package.json` already includes:
- ✅ `repository` field matching your GitHub repo (required for provenance)
- ✅ `publishConfig.access: public` for public publishing

### 2. Workflow Permissions

The workflow already has:
- ✅ `permissions: id-token: write` (required for OIDC/provenance)
- ✅ Runs on GitHub-hosted runner (`ubuntu-latest`)

## Setup Instructions

### Step 0: First-Time Publish (Manual, One-Time)

**Before setting up Trusted Publishing, you must publish the package once manually.**

npm doesn't show Trusted Publishing options until the package exists on the registry.

**Option A: Login and publish**

```bash
# Login to npm (prompts for username/password/OTP)
npm login

# Publish the package
bunx npm publish --access public
```

**Option B: Use a token**

```bash
# 1. Create token at https://www.npmjs.com/settings/tokens
# 2. Publish with token
bunx npm publish --token <YOUR_TOKEN> --access public
```

**After first publish:**
- Package exists on npm: https://www.npmjs.com/package/sofetch
- You can now configure Trusted Publishing in Step 1

### Step 1: Enable Trusted Publishing (Recommended, No Tokens)

1. Go to https://www.npmjs.com/settings/briansunter/access

2. Click "Add a publisher" or go to:
   https://www.npmjs.com/settings/briansunter/publishing/access-tokens

3. Configure the Trusted Publisher:

   | Field | Value |
   |-------|-------|
   | GitHub Organization / User | `briansunter` |
   | Repository | `sofetch` |
   | Workflow filename | `publish.yml` |
   | Environment name | (leave empty) |

4. Save the configuration

**This allows npm to authenticate via GitHub OIDC—no token needed!**

### Step 2: Publishing

To publish a new version:

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Commit and push
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git push origin master

# 3. Create and push version tag
git tag v3.0.1
git push origin v3.0.1
```

The GitHub Actions workflow will automatically:
- Run lint, typecheck, and tests
- Publish to npm with provenance

### Step 3: Verify Provenance

After publishing, verify provenance:

```bash
npm view sofetch versions
npm view sofetch --json | jq '.dist.attestations'
```

## Token Fallback (Optional)

If Trusted Publishing fails or you need a fallback:

1. Create an npm token: https://www.npmjs.com/settings/tokens
2. Add `NPM_TOKEN` as a GitHub Secret in your repo
3. Uncomment the `NODE_AUTH_TOKEN` env in the workflow:

```yaml
- name: Publish to npm
  run: bunx npm@11.5.1 publish --provenance --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Troubleshooting

### "404 Not Found" or "Permission Denied" with Trusted Publishing

**Cause:** Workflow doesn't match Trusted Publisher configuration

**Fix:** Ensure the workflow filename, repo, and user/org exactly match your npm Trusted Publisher settings.

### "Missing provenance" error

**Cause:** `id-token: write` permission missing

**Fix:** Verify the workflow has:
```yaml
permissions:
  id-token: write
```

### Version mismatch between tag and package.json

**Add a version guard step** before publishing:

```yaml
- name: Verify version matches tag
  run: |
    TAG_VERSION="${GITHUB_REF#refs/tags/v}"
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    if [ "$TAG_VERSION" != "$PACKAGE_VERSION" ]; then
      echo "Error: Tag version ($TAG_VERSION) does not match package.json ($PACKAGE_VERSION)"
      exit 1
    fi
```

## How It Works

1. **GitHub Actions OIDC**: When the workflow runs, GitHub generates an OIDC token
2. **npm CLI**: Uses `bunx npm@11.5.1` which supports Trusted Publishing (requires >= 11.5.1)
3. **Provenance**: The `--provenance` flag attaches cryptographic attestations to your package
4. **Verification**: Users can verify the package came from your GitHub repo

## References

- [npm Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-cloud-providers)
- [npm Provenance](https://docs.npmjs.com/generating-provenance-statements)
