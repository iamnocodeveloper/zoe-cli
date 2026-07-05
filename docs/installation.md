# Installation

How to install Zoe CLI and get it ready for first use.

## Requirements

- **Node.js 18+** (Node 20 LTS recommended). Verify with `node --version`.
- **npm** (bundled with Node.js) or another package manager like `pnpm`, `yarn`, or `bun`.
- An **InsForge account**. Sign up at [insforge.dev](https://insforge.dev) if you don't have one.
- A modern terminal that supports ANSI colors and Unicode.

## Install

```bash
npm install -g @nocodeveloper/zoe-cli
```

This installs the `zoe` command globally. Verify with:

```bash
zoe --version
```

### Alternative package managers

```bash
# pnpm
pnpm add -g @nocodeveloper/zoe-cli

# yarn
yarn global add @nocodeveloper/zoe-cli

# bun
bun add -g @nocodeveloper/zoe-cli
```

## Update

```bash
npm update -g @nocodeveloper/zoe-cli
```

## Uninstall

```bash
npm uninstall -g @nocodeveloper/zoe-cli
```

To also remove local data:

```bash
rm -rf ~/.zoe ~/.insforge
```

On Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.zoe"
Remove-Item -Recurse -Force "$env:USERPROFILE\.insforge"
```

## First-run setup

After installation, run `zoe login` once to authenticate with GitHub:

```bash
zoe login
```

A browser window opens for the GitHub OAuth flow. After you approve, your session is persisted to `~/.insforge/auth.json` — you won't be prompted again until the token expires.

Then start the chat:

```bash
zoe
```

## Run from source (for contributors)

```bash
git clone https://github.com/iamnocodeveloper/zoe-cli.git
cd zoe-cli
npm install
npm run dev
```

## Troubleshooting

### `zoe: command not found`

Your global `node_modules/.bin` is not on the `PATH`. Common causes:

- You used `nvm` — make sure `nvm` is sourced in your shell profile.
- You installed with a non-default prefix — add the prefix `bin` directory to `PATH`.
- On macOS/Linux, you may need `sudo` to install globally (or use `nvm`).

### Permissions errors on macOS/Linux

Avoid `sudo`. Instead, configure npm to use a user-owned prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

Add the `export PATH=…` line to your shell profile (`~/.zshrc`, `~/.bashrc`).

### Antivirus blocks the OAuth callback

Some Windows antivirus tools block Zoe's local callback server on port `3456`. Allow Node.js through your firewall or temporarily disable the protection during `zoe login`.

### Still stuck?

Run `zoe doctor` (coming in v0.2) or open a [GitHub issue](https://github.com/iamnocodeveloper/zoe-cli/issues) with:

- `zoe --version`
- `node --version`
- OS and shell
- The exact command and full error output
