# npm Publishing Setup

This document explains how to set up automated npm publishing with GitHub Actions using semantic-release and Bitwarden Secrets Manager (BWS).

## Overview

The release workflow:
- Triggers on push to `master` branch
- Uses Bun for install, lint, typecheck, and test
- Uses semantic-release for automated versioning based on commit messages
- Fetches NPM token from Bitwarden Secrets Manager
- Automatically generates changelog and GitHub releases

## How It Works

1. **Conventional Commits** determine version bumps:
   - `fix:` → patch (1.0.0 → 1.0.1)
   - `feat:` → minor (1.0.0 → 1.1.0)
   - `feat!:` or `BREAKING CHANGE:` → major (1.0.0 → 2.0.0)

2. **semantic-release** analyzes commits since last release and:
   - Determines next version number
   - Generates CHANGELOG.md
   - Publishes to npm
   - Creates GitHub release with notes

3. **BWS** securely provides the NPM token:
   - Token stored in Bitwarden Secrets Manager
   - Fetched at runtime via BWS CLI
   - Never stored in GitHub secrets directly

## Setup Instructions

### Step 1: Create NPM Token

1. Go to https://www.npmjs.com/settings/tokens
2. Create an "Automation" token with publish access
3. Copy the token

### Step 2: Store Token in Bitwarden Secrets Manager

1. Go to Bitwarden Secrets Manager
2. Create a new secret with the NPM token value
3. Note the secret ID (UUID)

### Step 3: Configure GitHub Secrets

Add these secrets to your GitHub repository:

| Secret | Description |
|--------|-------------|
| `BWS_ACCESS_TOKEN` | Bitwarden Secrets Manager access token |
| `BWS_NPM_SECRET_ID` | UUID of the secret containing NPM token |

### Step 4: Publishing

Simply push commits to `master` with conventional commit messages:

```bash
# Feature (minor version bump)
git commit -m "feat: add new export format"

# Bug fix (patch version bump)
git commit -m "fix: correct URL parsing"

# Breaking change (major version bump)
git commit -m "feat!: remove deprecated API"

git push origin master
```

The GitHub Actions workflow will automatically:
- Run lint, typecheck, and tests
- Fetch NPM token from BWS
- Determine the next version from commits
- Update CHANGELOG.md
- Publish to npm
- Create GitHub release

## Commit Message Convention

| Type | Description | Version Bump |
|------|-------------|--------------|
| `feat:` | New feature | Minor |
| `fix:` | Bug fix | Patch |
| `docs:` | Documentation | None |
| `chore:` | Maintenance | None |
| `refactor:` | Code refactoring | None |
| `test:` | Tests | None |
| `feat!:` | Breaking change | Major |

## Troubleshooting

### "Authentication error" from npm

Check that:
- BWS_ACCESS_TOKEN is valid
- BWS_NPM_SECRET_ID points to correct secret
- NPM token has publish permissions

### No release created

Check that commits follow conventional commit format (`feat:`, `fix:`, etc.).

### BWS fetch fails

Verify BWS access token has read access to the secret.

## Resources

- [semantic-release documentation](https://semantic-release.gitbook.io/)
- [Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/)
- [Conventional Commits](https://www.conventionalcommits.org/)
