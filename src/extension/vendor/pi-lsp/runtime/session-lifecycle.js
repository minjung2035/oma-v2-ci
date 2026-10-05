/** One session's complete tool invocations, including all diagnostics routes. */
export class LspSessionScope {
    #operations = new Map();
    #closing;
    assertOpen() {
        if (this.#closing)
            throw new Error("LSP session is closing; request aborted.");
    }
    context(ctx) {
        // Keep Pi's lazy context getters. Never reach an old UI getter once shutdown starts.
        return Object.create(ctx, {
            ui: {
                get: () => {
                    this.assertOpen();
                    return ctx.ui;
                },
            },
        });
    }
    async run(caller, operation) {
        this.assertOpen();
        const controller = new AbortController();
        const abort = () => controller.abort(new Error("LSP request aborted."));
        let settle;
        this.#operations.set(controller, new Promise((resolve) => {
            settle = resolve;
        }));
        caller?.addEventListener("abort", abort, { once: true });
        if (caller?.aborted)
            abort();
        try {
            controller.signal.throwIfAborted();
            const result = await operation(controller.signal);
            controller.signal.throwIfAborted();
            return result;
        }
        finally {
            caller?.removeEventListener("abort", abort);
            this.#operations.delete(controller);
            settle();
        }
    }
    close() {
        if (!this.#closing) {
            // Publish the closing state before abort callbacks can reenter this scope.
            this.#closing = Promise.allSettled(this.#operations.values()).then(() => { });
            for (const controller of this.#operations.keys()) {
                controller.abort(new Error("LSP session is closing; request aborted."));
            }
        }
        return this.#closing;
    }
}
