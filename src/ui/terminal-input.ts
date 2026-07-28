import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type TerminalInputOwner = 'main' | 'permission' | 'direct-command' | 'complexity-preview' | 'model-selection';

export class TerminalInputOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalInputOwnershipError';
  }
}

export class ExclusiveLineInput {
  private pending: { owner: TerminalInputOwner; resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private restored = 0;

  read(owner: TerminalInputOwner): Promise<string> {
    if (this.pending) throw new TerminalInputOwnershipError(`stdin is already owned by ${this.pending.owner}`);
    return new Promise<string>((resolve, reject) => {
      this.pending = { owner, resolve, reject };
    });
  }

  submit(line: string): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.pending = null;
    pending.resolve(line);
    this.restored++;
    return true;
  }

  cancel(owner: TerminalInputOwner, error = new Error('Terminal input cancelled.')): boolean {
    if (!this.pending || this.pending.owner !== owner) return false;
    const pending = this.pending;
    this.pending = null;
    pending.reject(error);
    this.restored++;
    return true;
  }

  owner(): TerminalInputOwner | null {
    return this.pending?.owner || null;
  }

  restorationCount(): number {
    return this.restored;
  }
}

export class TerminalInputCoordinator {
  private readonly router = new ExclusiveLineInput();
  private rl: Interface | null = null;
  private readonly lineListener = (line: string) => { this.router.submit(line); };

  constructor(
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout,
    private readonly interfaceFactory: typeof createInterface = createInterface,
  ) {}

  readLine(owner: TerminalInputOwner, prompt = ''): Promise<string> {
    this.ensureInterface();
    if (prompt) this.output.write(prompt);
    return this.router.read(owner);
  }

  cancel(owner: TerminalInputOwner, error?: Error): boolean {
    return this.router.cancel(owner, error);
  }

  activeOwner(): TerminalInputOwner | null {
    return this.router.owner();
  }

  ownedLineListenerCount(): number {
    return this.rl?.listenerCount('line') || 0;
  }

  close(): void {
    const owner = this.router.owner();
    if (owner) this.router.cancel(owner, new Error('Terminal input closed.'));
    if (!this.rl) return;
    this.rl.off('line', this.lineListener);
    this.rl.close();
    this.rl = null;
  }

  private ensureInterface(): void {
    if (this.rl) return;
    this.rl = this.interfaceFactory({ input: this.input, output: this.output });
    this.rl.on('line', this.lineListener);
  }
}

export const terminalInput = new TerminalInputCoordinator();
