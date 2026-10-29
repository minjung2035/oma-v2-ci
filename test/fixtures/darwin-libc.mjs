/** Controlled public-libc observation. The compiled SDK supplies the layout;
 * this is neither a resolver fallback nor an authority/complete-scope proof. */
export function observeNodeLibc(library, decode, layout, hostname = "example.com") {
  const lookup = library.func("int getaddrinfo(const char *node, const char *service, const void *hints, void *result)");
  const free = library.func("void freeaddrinfo(void *result)");
  const hints = Buffer.alloc(layout.size), pointer = Buffer.alloc(layout.pointerBytes);
  hints.writeInt32LE(layout.afUnspec, layout.family);
  hints.writeInt32LE(layout.sockStream, layout.socktype);
  const calls = [];
  for (const service of ["443", null]) {
    pointer.fill(0);
    const result = lookup(hostname, service, hints, pointer);
    const head = result === 0 ? decode(pointer, "void *") : null;
    let ipv4 = 0, ipv6 = 0;
    try {
      for (let item = head; item; item = decode(item, layout.next, "void *")) {
        const family = decode(item, layout.family, "int");
        if (family === layout.afInet) ++ipv4;
        if (family === layout.afInet6) ++ipv6;
      }
    } finally { if (head) free(head); }
    calls.push({ service, result, ipv4, ipv6 });
  }
  return { phase: "node-libc-resolver", pid: process.pid, uid: process.getuid(), hostname, layout,
    hints: { flags: 0, family: layout.afUnspec, socktype: layout.sockStream, protocol: 0 }, calls };
}
