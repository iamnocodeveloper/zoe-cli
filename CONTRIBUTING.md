# Contributing to Zoe CLI

Thanks for your interest in Zoe. We are building in public and we welcome contributions of all sizes — typo fixes, new tools, prompt engineering, documentation, bug reports, and feature ideas.

## Ground rules

- Be respectful and constructive. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Discuss significant changes in an issue **before** opening a pull request.
- Keep pull requests focused. One concern per PR.
- Test your change locally before submitting.

## Quick start

### 1. Fork and clone

```bash
git clone https://github.com/<your-username>/zoe-cli.git
cd zoe-cli
```

### 2. Install dependencies

```bash
npm install
```

Requires Node.js 18+.

### 3. Run the CLI locally

```bash
npm run dev
```

This runs the CLI from source with hot-reload. You will need an InsForge account and to run `zoe login` once.

### 4. Build and typecheck

```bash
npm run build       # compile TypeScript to dist/
npm run typecheck   # tsc --noEmit
```

Both must pass before submitting a PR.

## Project layout

```
src/
├── cli/         # entry point + command handlers
├── core/        # agent, config, insforge client, prompts, tools
├── tools/       # file operations, shell, search
└── ui/          # display, logo, banner, prompts
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full picture.

## Where to start

- **`good first issue`** — small, well-scoped tasks. Look for this label.
- **`help wanted`** — issues where we would specifically like help.
- **`documentation`** — improvements to docs, examples, and guides.

## Coding style

- **TypeScript**, strict mode, ESM (`"type": "module"`).
- 2-space indentation, single quotes, no semicolons are **not** the style here — match the surrounding file.
- Prefer small, named exports. Avoid default exports.
- Keep tools in `src/tools/` focused: one responsibility per file.
- Prompts are code. Treat them with the same care as any other source file.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

Examples:

```
feat(tools): add list_directory recursive option
fix(insforge): refresh token on 401
docs(readme): clarify installation for Windows
```

## Pull request process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make focused commits with clear messages.
3. Make sure `npm run build` and `npm run typecheck` pass.
4. Push your branch and open a PR against `main`.
5. Fill in the PR template. Link the relevant issue.
6. Wait for review. Address feedback by pushing additional commits (do not force-push after review starts).
7. A maintainer will merge once CI is green and review is approved.

## Reporting bugs

Open a GitHub issue using the **Bug Report** template. Include:

- Zoe version (`zoe --version`)
- Node version (`node --version`)
- OS and shell
- Exact command that produced the bug
- Expected vs actual behavior
- Full error output, if any

## Suggesting features

Open a GitHub issue using the **Feature Request** template. Explain the problem you are trying to solve before proposing a solution. We are more likely to act on a problem we agree with than a feature we are unsure about.

## Security issues

**Do not open a public issue for security vulnerabilities.** See [SECURITY.md](./SECURITY.md) for the private disclosure process.

## Code of conduct

By participating, you agree to abide by the [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
