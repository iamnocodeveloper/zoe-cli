# Zoe CLI — Terminal UX

Zoe uses a dark, restrained terminal interface with violet/blue Zoe accent, green success, yellow warning, red error and gray metadata. It must show workspace, Git state when available, model, inferred mode, Cloud/session state and active task phase without a noisy banner.

```text
 Zoe CLI   workspace: my-app   branch: main*   model: DeepSeek Flash
 Cloud: connected   mode: Build   task: verifying

 • Understand workspace
 ✓ Plan approved
 • Edit src/App.tsx
 • Run npm run build
```

Permission prompts must name the action, target and risk. A session failure appears once with `zoe login` guidance. Reduced-color output must retain clear text labels. `/paste … .done`, `/scan`, `/model`, `/clear`, `/exit`, and ESC behavior require documented, tested interaction contracts. Status: Pending owner decision on final startup layout and shortcut set.
