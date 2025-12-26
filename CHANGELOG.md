# [2.0.0](https://github.com/briansunter/archfetch/compare/v1.0.0...v2.0.0) (2025-12-26)


### Code Refactoring

* remove Docker mode and add force-playwright flag ([9bb491c](https://github.com/briansunter/archfetch/commit/9bb491c1b4ea3dda95590830afeb30074dea47cb))


### BREAKING CHANGES

* Remove Docker mode for Playwright

- Remove Docker browser manager (docker.ts)
- Remove --playwright <mode> CLI flag
- Remove SOFETCH_PLAYWRIGHT_MODE and SOFETCH_DOCKER_IMAGE env vars
- Simplify to local Playwright only (faster, more reliable)

Features:
- Add --force-playwright flag to skip simple fetch
- Add --wait-strategy flag (networkidle/domcontentloaded/load)
- Update postinstall to avoid redownloading Playwright

Fixes:
- Fix container reuse logic (no longer needed)
- Update tests to remove Docker assertions
- Update package.json description

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>

# 1.0.0 (2025-12-26)


* feat!: rename package from arcfetch to archfetch ([1027ed0](https://github.com/briansunter/archfetch/commit/1027ed0e52986cdf3b7b5b8e4e7ab0fb9334894f))


### Bug Fixes

* add .npmignore and files field for clean package ([f0216f4](https://github.com/briansunter/archfetch/commit/f0216f4a196f8dfff8fad66afab3280da7334223))
* correct bin field path in package.json ([b66ef76](https://github.com/briansunter/archfetch/commit/b66ef76076fb8dfe76f251a746ba2716f74a84e9))
* correct BWS download URL to sdk-sm repo ([c2d1448](https://github.com/briansunter/archfetch/commit/c2d14489551e042083298d91fbfc908ffabaa14f))
* set NODE_AUTH_TOKEN for npm auth ([fbbfc4d](https://github.com/briansunter/archfetch/commit/fbbfc4d02d09d1cc527cd219568a67793bb36334))
* update repo URL after rename to archfetch ([3f78e62](https://github.com/briansunter/archfetch/commit/3f78e6254af9c68d85e892974e48d68060dee13d))
* use correct GitHub repo URL (arcfetch) ([6127344](https://github.com/briansunter/archfetch/commit/6127344fd56374de09e68e2aadd390163720e9dd))


### Features

* **ci:** add npm publishing with GitHub Actions OIDC ([336a5eb](https://github.com/briansunter/archfetch/commit/336a5eb97d7ef4fced80a9f4febb0b599ee4cad4))
* **commands:** add hello command ([7fa6319](https://github.com/briansunter/archfetch/commit/7fa6319c824f9fe04a6b4594f855586a1a570b42))
* **skills:** add comprehensive Fetchi CLI skill ([008be33](https://github.com/briansunter/archfetch/commit/008be332012cf4a0bf41b882004026e0214dba20))


### BREAKING CHANGES

* Package renamed from arcfetch to archfetch.
- Update all references to use archfetch
- Add semantic-release for automated publishing
- Add CI workflow for PRs
- Use BWS for npm token management

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
