import test from 'node:test';
test("001. Installed Broker owns actual listeners and drain while its caller owns the native lock",async()=>{await import('./installed-runtime.mjs');});
