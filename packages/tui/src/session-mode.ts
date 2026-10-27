/** One pre-session choice, before either engine owns the terminal. */
import type { SessionMode } from "@oma/domain/session-mode";
import { HOST_LOSS_SIGNALS } from "@oma/domain/host-signals";
import { KeyDecoder, type Key } from "./keys.js";
import { openTerminal, releaseTerminalResources, type TerminalStreams } from "./screen.js";
import { renderSessionMode } from "./view/index.js";

export function chooseSessionMode(streams: TerminalStreams): Promise<SessionMode | null> {
  return chooseTerminalItem(streams, { items: ["society", "personal"] as const,
    render: (selected, width, height) => renderSessionMode(selected, width, height) });
}

/** One terminal/decoder lifetime for pre-engine choices; no second cleanup owner. */
function chooseTerminalItem<T>(streams: TerminalStreams, choice: {
  readonly items: readonly T[]; readonly render: (selected: T, width: number, height: number) => readonly string[];
}): Promise<T | null> {
  if (choice.items.length === 0) return Promise.resolve(null);
  if (!streams.input.isTTY || !streams.output.isTTY) return Promise.resolve(choice.items[0]!);
  return new Promise((resolve, reject) => {
    const terminal = openTerminal(streams);
    const keys = new KeyDecoder();
    let index = 0, closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (): void => {
      const width = Math.max(1, (streams.output.columns ?? terminal.columns) - 1);
      const height = Math.max(1, streams.output.rows ?? terminal.rows);
      terminal.draw(choice.render(choice.items[index]!, width, height));
    };
    const finish = (mode: T | null, failure?: unknown): void => {
      if (closed) return;
      closed = true;
      const pending = timer; timer = undefined;
      try {
        releaseTerminalResources([
          () => { if (pending !== undefined) clearTimeout(pending); },
          () => { keys.finish(); },
          () => { streams.input.off("end", cancel); },
          () => { streams.input.off("close", cancel); },
          () => { streams.output.off("close", cancel); },
          () => { streams.input.off("error", fail); },
          () => { streams.output.off("error", fail); },
          ...HOST_LOSS_SIGNALS.map(signal => () => { process.off(signal, cancel); }),
          () => terminal.restore(),
        ]);
      } catch (error) { reject(failure === undefined ? error : new AggregateError([failure, error], "mode selection and cleanup failed")); return; }
      if (failure !== undefined) reject(failure); else resolve(mode);
    };
    const cancel = (): void => finish(null);
    const fail = (error: unknown): void => finish(null, error);
    const apply = (key: Key): void => {
      if (closed) return;
      if (key.kind === "enter") finish(choice.items[index]!);
      else if (key.kind === "escape" || key.kind === "interrupt" || key.kind === "eof") cancel();
      else if (key.kind === "up" || key.kind === "down") {
        index = (index + (key.kind === "up" ? choice.items.length - 1 : 1)) % choice.items.length; draw();
      }
      else if (key.kind === "redraw") { terminal.repaint(); draw(); }
    };
    try {
      streams.input.once("end", cancel); streams.input.once("close", cancel); streams.output.once("close", cancel);
      streams.input.on("error", fail); streams.output.on("error", fail);
      for (const signal of HOST_LOSS_SIGNALS) process.on(signal, cancel);
      terminal.onResize(() => {
        if (closed) return;
        try { terminal.repaint(); draw(); } catch (error) { fail(error); }
      });
      terminal.onKeys(chunk => {
        if (closed) return;
        try {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          for (const key of keys.push(chunk)) apply(key);
          if (closed || keys.pendingDelayMs === null) return;
          const pending = setTimeout(() => {
            if (closed || timer !== pending) return;
            timer = undefined;
            try { for (const key of keys.flushPending()) apply(key); } catch (error) { fail(error); }
          }, keys.pendingDelayMs);
          timer = pending;
        } catch (error) { fail(error); }
      });
      draw();
    } catch (error) { fail(error); }
  });
}
