export type StreamingResponseState = 'THINKING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export class EmptyModelResponseError extends Error {
  readonly code = 'EMPTY_MODEL_RESPONSE';
  readonly recoverable = true;

  constructor() {
    super('The model returned an empty response.');
    this.name = 'EmptyModelResponseError';
  }
}

export interface StreamingResponseOutput {
  startProgress(): void;
  stopProgress(): void;
  writeContent(chunk: string): void;
  finishContent(): void;
}

export class StreamingResponseController {
  private state: StreamingResponseState = 'THINKING';
  private content = '';
  private contentStarted = false;
  private contentFinished = false;

  constructor(private readonly output: StreamingResponseOutput) {}

  start(): void {
    if (this.state !== 'THINKING') return;
    this.output.startProgress();
  }

  chunk(value: string): void {
    if (this.state === 'COMPLETED' || this.state === 'FAILED' || this.state === 'CANCELLED' || !value) return;
    if (!this.contentStarted) {
      this.output.stopProgress();
      this.contentStarted = true;
      this.state = 'STREAMING';
    }
    this.content += value;
    this.output.writeContent(value);
  }

  complete(): string {
    this.output.stopProgress();
    if (!this.content.trim()) {
      this.state = 'FAILED';
      throw new EmptyModelResponseError();
    }
    this.state = 'COMPLETED';
    this.finishOnce();
    return this.content;
  }

  fail(): void {
    this.output.stopProgress();
    this.state = 'FAILED';
    this.finishOnce();
  }

  cancel(): void {
    this.output.stopProgress();
    this.state = 'CANCELLED';
    this.finishOnce();
  }

  currentState(): StreamingResponseState {
    return this.state;
  }

  accumulatedContent(): string {
    return this.content;
  }

  private finishOnce(): void {
    if (!this.contentStarted || this.contentFinished) return;
    this.contentFinished = true;
    this.output.finishContent();
  }
}
