# Security Policy

## Alpha support

`0.1.0-alpha.x` receives best-effort security fixes while the alpha channel is active. Older previews and unpublished development builds are unsupported.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Email [security@getzoe.cloud](mailto:security@getzoe.cloud) with:

- impact and affected version;
- minimal reproduction steps;
- operating system and Node.js version;
- redacted logs, if relevant.

Never send OAuth tokens, npm tokens, private keys, `.npmrc`, `.env`, checkpoint files or unredacted source code.

## Local security model

- Treat `~/.zoe/` and authentication storage as sensitive.
- Review previews, paths and commands before approving changes.
- Package installation requires its own confirmation.
- Git awareness is read-only and performs no network operations.
- Safe Resume rejects workspace or Git drift and never reuses approvals.
- Permission controls reduce risk but do not provide an operating-system sandbox.

If credentials may be compromised, run `zoe logout`, revoke the relevant service session and rotate affected credentials.

## Release integrity

Official npm prereleases use the `alpha` dist-tag. Inspect the package version and contents before installation. Published npm versions are immutable; a defective release should be deprecated and replaced by a newer prerelease.
