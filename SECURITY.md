# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

We take all reports seriously. To disclose a vulnerability privately:

📧 **Email:** [security@getzoe.cloud](mailto:security@getzoe.cloud)

Please include as much of the following as you can:

- A clear description of the issue and its impact
- Steps to reproduce, or a proof-of-concept
- The affected version (`zoe --version`) and commit hash if known
- Your name / handle if you would like to be credited in the fix release notes (otherwise reports are kept anonymous by default)

You should receive an acknowledgement within **3 business days**.

## What to expect

1. **Triage** — we will confirm the report and assess severity within 5 business days.
2. **Fix** — we will develop a patch privately and coordinate a release.
3. **Disclosure** — once a fix is published, we will credit you (with your permission) in the release notes and publish a short advisory describing the issue and its impact.
4. **Coordinated timeline** — for serious issues, we may ask for a reasonable delay before public disclosure so users can update.

## Scope

The following are in scope for this policy:

- The Zoe CLI source code under `src/`
- The Zoe npm package `@nocodeveloper/zoe-cli`
- Authentication, session handling, and local storage behaviour
- File reading, writing, or execution behaviour that could be unexpected

Out of scope:

- Bugs in third-party dependencies (please report upstream)
- Issues in upstream services (InsForge, model providers) — report there

## Supported versions

| Version | Supported |
| --- | --- |
| `latest` (currently `2.5.3`) | ✅ |
| `preview` (currently `0.2.0-preview.8`) | ⚠️ best-effort |
| Older versions | ❌ please upgrade |

## Best practices for users

- Keep Zoe updated to the latest `npm` tag.
- Treat your `~/.zoe/` and `~/.insforge/` folders as sensitive — they contain auth tokens.
- Review the file changes Zoe proposes before confirming destructive actions.
- If you suspect your machine is compromised, run `zoe logout` and rotate your InsForge account credentials.

## Acknowledgements

We thank the security community for responsible disclosure. Reporters who follow this process will be credited (with permission) in the relevant release notes.
