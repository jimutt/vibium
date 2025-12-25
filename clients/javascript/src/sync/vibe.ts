import { SyncBridge } from './bridge';
import { ElementSync } from './element';
import { ElementInfo } from '../element';
import { FindOptions, ScrollOptions } from '../vibe';

export class VibeSync {
  private bridge: SyncBridge;

  /** Scroll methods for page navigation */
  public readonly scroll: {
    /** Scroll down by pixels (default: 300) */
    down: (options?: ScrollOptions) => void;
    /** Scroll up by pixels (default: 300) */
    up: (options?: ScrollOptions) => void;
    /** Scroll an element into view */
    toElement: (selector: string) => void;
  };

  constructor(bridge: SyncBridge) {
    this.bridge = bridge;

    // Initialize scroll methods bound to this instance
    this.scroll = {
      down: (options?: ScrollOptions) => {
        const pixels = options?.pixels ?? 300;
        this.evaluate(`window.scrollBy(0, ${pixels})`);
      },
      up: (options?: ScrollOptions) => {
        const pixels = options?.pixels ?? 300;
        this.evaluate(`window.scrollBy(0, -${pixels})`);
      },
      toElement: (selector: string) => {
        this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior: 'instant', block: 'center'})`);
      },
    };
  }

  go(url: string): void {
    this.bridge.call('go', [url]);
  }

  screenshot(): Buffer {
    const result = this.bridge.call<{ data: string }>('screenshot');
    return Buffer.from(result.data, 'base64');
  }

  /**
   * Execute JavaScript in the page context.
   */
  evaluate<T = unknown>(script: string): T {
    const result = this.bridge.call<{ result: T }>('evaluate', [script]);
    return result.result;
  }

  /**
   * Find an element by CSS selector.
   * Waits for element to exist before returning.
   */
  find(selector: string, options?: FindOptions): ElementSync {
    const result = this.bridge.call<{ elementId: number; info: ElementInfo }>('find', [selector, options]);
    return new ElementSync(this.bridge, result.elementId, result.info);
  }

  quit(): void {
    this.bridge.call('quit');
    this.bridge.terminate();
  }
}
