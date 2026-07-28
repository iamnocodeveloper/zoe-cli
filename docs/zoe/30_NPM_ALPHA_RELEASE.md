# npm Alpha Release Procedure

## Current decision

The package candidate is technically validated but publication is blocked until the owner authenticates npm and reviews the dirty Git worktree. No publish, commit, tag or push was executed.

The registry is `https://registry.npmjs.org/`. The scoped package already exists and public metadata identifies the `nocodeveloper` maintainer. Version `0.4.0-alpha.0` was confirmed available during ZOE-018.

## Pre-publish gate

```powershell
npm.cmd login
npm.cmd whoami
npm.cmd view @nocodeveloper/zoe-cli versions --json
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd pack --dry-run
npm.cmd publish --dry-run --access public --tag alpha
git diff --check
git status --short
```

Never paste an npm token or OTP into source, documentation or chat.

## Exact publication command

Run only after separate owner approval and successful `npm.cmd whoami`:

```powershell
npm.cmd publish --access public --tag alpha
```

Do not omit `--tag alpha`; this release must not change `latest`.

## Owner-controlled Git release

Review and stage only intended files first. The repository contains unrelated/pre-existing changes, so no blanket staging command is recommended.

After the owner has staged the exact release set:

```powershell
git diff --cached --check
git commit -m "chore: release Zoe CLI 0.4.0-alpha.0"
git tag -a v0.4.0-alpha.0 -m "Zoe CLI 0.4.0-alpha.0"
git push origin main
git push origin v0.4.0-alpha.0
```

Remote: `https://github.com/iamnocodeveloper/zoe-cli.git`.

## Post-publication verification

```powershell
npm.cmd view @nocodeveloper/zoe-cli version
npm.cmd view @nocodeveloper/zoe-cli dist-tags
npm.cmd view @nocodeveloper/zoe-cli@0.4.0-alpha.0
npm.cmd install --global @nocodeveloper/zoe-cli@alpha
zoe --version
zoe --help
```

## Provenance

Local publication does not provide trusted CI provenance. If provenance is required, publish later from a supported CI environment using npm trusted publishing/OIDC and the same `--access public --tag alpha` policy. Do not add `--provenance` locally unless npm can verify the build environment.

## Rollback reality

npm versions are immutable. For a serious defect:

1. Deprecate the affected version when appropriate.
2. Publish a corrected prerelease version selected explicitly by the owner.
3. Move the `alpha` dist-tag to the corrected version.

Do not attempt to overwrite or silently replace `0.4.0-alpha.0`.
