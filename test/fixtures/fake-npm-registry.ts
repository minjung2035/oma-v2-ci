/** A local npm registry for tests: one package per `npm pack`ed directory,
 * served from 127.0.0.1 only. npm reaches it through `npm_config_registry`, so
 * installing a package needs no network. */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface FakeRegistry {
  readonly url: string;
  readonly requests: readonly string[];
  close(): Promise<void>;
}

/** Packs each directory with npm and serves it under its package name. */
export async function fakeNpmRegistry(packages: readonly string[], scratch: string): Promise<FakeRegistry> {
  const tarballs = new Map<string, { name: string; version: string; bytes: Buffer }>();
  for (const dir of packages) {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; version: string };
    const packed = spawnSync("npm", ["pack", "--silent", "--pack-destination", scratch], { cwd: dir, encoding: "utf8", timeout: 60000 });
    if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
    const file = readdirSync(scratch).find(name => name.endsWith(`-${manifest.version}.tgz`) && name.startsWith(manifest.name.replace("@", "").replace("/", "-")));
    if (file === undefined) throw new Error(`npm pack left no tarball for ${manifest.name}`);
    tarballs.set(manifest.name, { ...manifest, bytes: readFileSync(join(scratch, file)) });
  }
  const requests: string[] = [];
  let base = "";
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    requests.push(`${request.method} ${path}`);
    for (const item of tarballs.values()) {
      if (path === `/${item.name}`) {
        const integrity = `sha512-${createHash("sha512").update(item.bytes).digest("base64")}`;
        const shasum = createHash("sha1").update(item.bytes).digest("hex");
        const version = { name: item.name, version: item.version, dist: { tarball: `${base}/${item.name}/-/${item.name}-${item.version}.tgz`, integrity, shasum } };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ name: item.name, "dist-tags": { latest: item.version }, versions: { [item.version]: version } }));
        return;
      }
      if (path === `/${item.name}/-/${item.name}-${item.version}.tgz`) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(item.bytes);
        return;
      }
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { url: `${base}/`, requests, close: () => new Promise<void>(resolve => { server.close(() => { resolve(); }); }) };
}
