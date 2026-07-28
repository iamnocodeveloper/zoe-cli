# Installing Zoe CLI Alpha

## Supported environment

- Windows 10/11
- PowerShell
- Node.js 18 or newer
- npm
- Git when repository awareness is desired

macOS and Linux are future targets and are not validated for `0.4.0-alpha.0`.

## Install the public alpha

After publication:

```powershell
npm.cmd install --global @nocodeveloper/zoe-cli@alpha
zoe --version
zoe --help
```

The expected version is `0.4.0-alpha.0`.

## First run

```powershell
zoe login
```

This opens the supported InsForge GitHub OAuth browser flow. Device-code authentication is deferred.

Then run Zoe from a disposable or version-controlled project:

```powershell
cd C:\path\to\project
zoe
```

## Local tarball validation

```powershell
npm.cmd install --global C:\absolute\path\nocodeveloper-zoe-cli-0.4.0-alpha.0.tgz
zoe --version
```

Use a temporary npm prefix when testing without changing the permanent global installation:

```powershell
npm.cmd install --global --prefix C:\temporary\zoe-prefix C:\absolute\path\nocodeveloper-zoe-cli-0.4.0-alpha.0.tgz
C:\temporary\zoe-prefix\zoe.cmd --help
```

## Troubleshooting

- `zoe` not found: ensure the npm global prefix is on `PATH`.
- OAuth failure: verify network access and retry `zoe login`.
- Session status: run `zoe whoami`.
- Environment checks: run `zoe doctor`.
- Debug markers: set `ZOE_DEBUG=true` temporarily and redact output before sharing.
- Resume rejection: confirm checkpoint state, workspace contents and Git state are unchanged.

Do not share `.npmrc`, OAuth tokens, `.env` files or files under `~/.zoe/`.
