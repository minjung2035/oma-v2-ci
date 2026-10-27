#!/usr/bin/env node
import { NPM_METADATA_PACKAGING, preserveNpmMetadata, vendorPackagingProblems } from "./vendor-bundle-lib.mjs";
/** Vendored pi-web-access bundle maintenance — the only writer of
 * `apps/oma/src/extension/vendor/pi-web-access/runtime/` and `manifest.json`.
 *
 * `upstream/` is the exact npm tarball snapshot of pi-web-access (verified
 * against `package/npm integrity` and `shasum` at vendoring time) and is
 * never touched here. `upstream-tests/` is the repository's `test/` tree at
 * the same commit — the npm tarball ships no tests — kept for provenance
 * and porting; they are not wired into `npm test` (upstream's suite needs
 * the upstream repo layout and hits the network for most providers).
 * `node_modules/` is the pinned runtime dependency closure, byte-exact to
 * the npm-installed production tree named in DEPENDENCIES, kept separate
 * from anything a user-installed Pi package would resolve.
 *
 * `runtime/` is tsc's emit of upstream's .ts modules, compiled with
 * upstream's own compiler flags (module ESNext + moduleResolution bundler —
 * see upstream/tsconfig.json in the source repo), with two mechanical steps
 * applied around it:
 *
 *  1. `rewriteSourceSpecifiers`: upstream imports its siblings as "./x.ts",
 *     which Node's ESM loader cannot resolve and which tsc will not emit
 *     under allowImportingTsExtensions. Before compile, every relative
 *     "./x.ts" specifier in a staged copy is rewritten to "./x.js"; tsc
 *     then emits .js and .d.ts already carrying Node-loadable specifiers.
 *     This is not an OMA divergence — it is derived entirely from the
 *     vendored source tree. A specifier that resolves to nothing upstream
 *     holds is a regeneration failure.
 *  2. OMA_DIVERGENCES: the only semantic difference between upstream emit
 *     and runtime/. Each splice is an exact-once anchor replacement over
 *     the post-rewrite bytes; a drifted anchor fails loudly.
 *
 * Every upstream .ts module is emitted — including index.ts, the extension
 * entry the OMA adapter drives — and every module's vendored dependency
 * imports resolve from the bundle's own node_modules.
 *
 * This script never reaches the network: npm integrity/shasum/commit are
 * recorded metadata, verified once at vendoring time.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  applyDivergences, bundleDigest, bundleRecordProblems, bundleRecords, canonical,
  divergenceMetadata, divergenceProblems, emittedRuntimeProblems, filesUnder, sha256,
  slash, writeRuntimeTree,
} from "./vendor-bundle-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(root, "packages/tool-web/src/vendor/pi-web-access");
const UPSTREAM_DIR = join(BUNDLE_DIR, "upstream");
const RUNTIME_DIR = join(BUNDLE_DIR, "runtime");
const UPSTREAM_TESTS_DIR = join(BUNDLE_DIR, "upstream-tests");
const MANIFEST_PATH = join(BUNDLE_DIR, "manifest.json");

const EXPECTED_PACKAGE = Object.freeze({
  name: "pi-web-access",
  version: "0.35.0",
  // The commit whose tree the npm tarball was published from: every tarball
  // .ts file plus LICENSE, README.md, CHANGELOG.md and SECURITY.md matches
  // this commit byte-for-byte. package.json differs in exactly upstream's
  // own postpublish rewrite (`pi-extensions-dist.js` flips the extensions
  // entry "./index.ts" -> "./dist"). upstream-tests/ is this commit's
  // test/ tree, byte-exact.
  commit: "72c6e67787d67d8a7d01bf0abf30c072a6112de6",
  npmIntegrity: "sha512-D1GMJMNDG2omAkL1ztmO6ZEwEyW7LoFpTcckKh2yXjLyAgDFuhpTQrs2jQPAlVtGb3rjAeIXRZrkhFcwSWdGSg==",
  npmShasum: "a807f0d5c6dfa6893f24e00320774a55425f864b",
});

/** The runtime dependency closure vendored under node_modules/ — the
 * production `npm install` resolution of upstream's declared dependencies,
 * pinned to the exact lockfile entries at vendoring time. Keys are the
 * vendored subpaths under node_modules/ (nested entries record npm's
 * version-conflict nesting verbatim). Every name+version is verified
 * against the vendored package.json on --check, and every file's bytes are
 * bound by manifest.files and the bundle digest. Peer/host API packages
 * (@earendil-works/pi-coding-agent, @earendil-works/pi-tui,
 * @earendil-works/pi-ai, typebox) resolve to OMA's own install — they are
 * the host API, not payload. */
const DEPENDENCIES = Object.freeze({
  "@hono/node-server": { version: "1.19.17", integrity: "sha512-dSneS5qhiauZWGDCeK4o695Xd9nUNjviSZCMQrj10eetr8Uln1ucn6bbphOM6UynAMMtNIzZNSpL9vnASJwrPQ==" },
  "@mixmark-io/domino": { version: "2.2.0", integrity: "sha512-Y28PR25bHXUg88kCV7nivXrP2Nj2RueZ3/l/jdx6J9f8J4nsEGcgX0Qe6lt7Pa+J79+kPiJU3LguR6O/6zrLOw==" },
  "@modelcontextprotocol/sdk": { version: "1.27.1", integrity: "sha512-sr6GbP+4edBwFndLbM60gf07z0FQ79gaExpnsjMGePXqFcSSb7t6iscpjk9DhFhwd+mTEQrzNafGP8/iGGFYaA==" },
  "@mozilla/readability": { version: "0.6.0", integrity: "sha512-juG5VWh4qAivzTAeMzvY9xs9HY5rAcr2E4I7tiSSCokRFi7XIZCAu92ZkSTsIj1OPceCifL3cpfteP3pDT9/QQ==" },
  "@xmldom/xmldom": { version: "0.9.12", integrity: "sha512-5AXjrcMClTryPe9LgZrygpB1lj7s0S9E0+W+AHaVKAVyHanafK86iPSvG5xHVSp/jC+VH1UXu0TAEmY279xH7A==" },
  "accepts": { version: "2.0.0", integrity: "sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==" },
  "ajv": { version: "8.20.0", integrity: "sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==" },
  "ajv-formats": { version: "3.0.1", integrity: "sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==" },
  "array-buffer-byte-length": { version: "1.0.2", integrity: "sha512-LHE+8BuR7RYGDKvnrmcuSq3tDcKv9OFEXQt/HpbZhY7V6h0zlUXutnAD82GiFx9rdieCMjkvtcsPqBwgUl1Iiw==" },
  "arraybuffer.prototype.slice": { version: "1.0.4", integrity: "sha512-BNoCY6SXXPQ7gF2opIP4GBE+Xw7U+pHMYKuzjgCN3GwiaIR09UUeKfheyIry77QtrCBlC0KK0q5/TER/tYh3PQ==" },
  "async-function": { version: "1.0.0", integrity: "sha512-hsU18Ae8CDTR6Kgu9DYf0EbCr/a5iGL0rytQDobUcdpYOKokk8LEjVphnXkDkgpi0wYVsqrXuP0bZxJaTqdgoA==" },
  "available-typed-arrays": { version: "1.0.7", integrity: "sha512-wvUjBtSGN7+7SjNpq/9M2Tg350UZD3q62IFZLbRAR1bSMlCo1ZaeW+BJ+D090e4hIIZLBcTDWe4Mh4jvUDajzQ==" },
  "body-parser": { version: "2.3.0", integrity: "sha512-2cGmJupaNgg+QUwVLAucDuWuoMZ6EX9iHDRswZ5lsNYEmwPaRknMPCLZz07yTzVq/83p4o/wzbDZbBrTvGGTIw==" },
  "body-parser/node_modules/content-type": { version: "2.1.0", integrity: "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==" },
  "boolbase": { version: "1.0.0", integrity: "sha512-JZOSA7Mo9sNGB8+UjSgzdLtokWAky1zbztM3WRLCbZ70/3cTANmQmOdR7y2g+J0e2WXywy1yS468tY+IruqEww==" },
  "bytes": { version: "3.1.2", integrity: "sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg==" },
  "call-bind": { version: "1.0.9", integrity: "sha512-a/hy+pNsFUTR+Iz8TCJvXudKVLAnz/DyeSUo10I5yvFDQJBFU2s9uqQpoSrJlroHUKoKqzg+epxyP9lqFdzfBQ==" },
  "call-bind-apply-helpers": { version: "1.0.2", integrity: "sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==" },
  "call-bound": { version: "1.0.4", integrity: "sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==" },
  "commander": { version: "12.1.0", integrity: "sha512-Vw8qHK3bZM9y/P10u3Vib8o/DdkvA2OtPtZvD871QKjy74Wj1WSKFILMPRPSdUSx5RFK1arlJzEtA4PkFgnbuA==" },
  "content-disposition": { version: "1.1.0", integrity: "sha512-5jRCH9Z/+DRP7rkvY83B+yGIGX96OYdJmzngqnw2SBSxqCFPd0w2km3s5iawpGX8krnwSGmF0FW5Nhr0Hfai3g==" },
  "content-type": { version: "1.0.5", integrity: "sha512-nTjqfcBFEipKdXCv4YDQWCfmcLZKm81ldF0pAopTvyrFGVbcR6P/VAAd5G7N+0tTr8QqiU0tFadD6FK4NtJwOA==" },
  "cookie": { version: "0.7.2", integrity: "sha512-yki5XnKuf750l50uGTllt6kKILY4nQ1eNIQatoXEByZ5dWgnKqbnqmTrBE5B4N7lrMJKQ2ytWMiTO2o0v6Ew/w==" },
  "cookie-signature": { version: "1.2.2", integrity: "sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==" },
  "cors": { version: "2.8.6", integrity: "sha512-tJtZBBHA6vjIAaF6EnIaq6laBBP9aq/Y3ouVJjEfoHbRBcHBAHYcMh/w8LDrk2PvIMMq8gmopa5D4V8RmbrxGw==" },
  "cross-spawn": { version: "7.0.6", integrity: "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==" },
  "css-select": { version: "5.2.2", integrity: "sha512-TizTzUddG/xYLA3NXodFM0fSbNizXjOKhqiQQwvhlspadZokn1KDy0NZFS0wuEubIYAV5/c1/lAr0TaaFXEXzw==" },
  "css-what": { version: "6.2.2", integrity: "sha512-u/O3vwbptzhMs3L1fQE82ZSLHQQfto5gyZzwteVIEyeaY5Fc7R4dapF/BvRoSYFeqfBk4m0V1Vafq5Pjv25wvA==" },
  "cssom": { version: "0.5.0", integrity: "sha512-iKuQcq+NdHqlAcwUY0o/HL69XQrUaQdMjmStJ8JFmUaiiQErlhrmuigkg/CU4E2J0IyUKUrMAgl36TvN67MqTw==" },
  "data-view-buffer": { version: "1.0.2", integrity: "sha512-EmKO5V3OLXh1rtK2wgXRansaK1/mtVdTUEiEI0W8RkvgT05kfxaH29PliLnpLP73yYO6142Q72QNa8Wx/A5CqQ==" },
  "data-view-byte-length": { version: "1.0.2", integrity: "sha512-tuhGbE6CfTM9+5ANGf+oQb72Ky/0+s3xKUpHvShfiz2RxMFgFPjsXuRLBVMtvMs15awe45SRb83D6wH4ew6wlQ==" },
  "data-view-byte-offset": { version: "1.0.1", integrity: "sha512-BS8PfmtDGnrgYdOonGZQdLZslWIeCGFP9tpan0hi1Co2Zr2NKADsvGYA8XxuG/4UWgJ6Cjtv+YJnB6MM69QGlQ==" },
  "debug": { version: "4.4.3", integrity: "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==" },
  "define-data-property": { version: "1.1.4", integrity: "sha512-rBMvIzlpA8v6E+SJZoo++HAYqsLrkg7MSfIinMPFhmkorw7X+dOXVJQs+QT69zGkzMyfDnIMN2Wid1+NbL3T+A==" },
  "define-properties": { version: "1.2.1", integrity: "sha512-8QmQKqEASLd5nx0U1B1okLElbUuuttJ/AnYmRXbbbGDWh6uS208EjD4Xqq/I9wK7u0v6O08XhTWnt5XtEbR6Dg==" },
  "defuddle": { version: "0.19.3", integrity: "sha512-5ZbOQ/B+iiRRqSQWwmCx/zEuqZOA/5q7gxyE2/4O2Bxq7nUC0PgKw9EdyxqWbFF1nrrrYemSeR25jg4TmA2fsA==" },
  "defuddle/node_modules/boolbase": { version: "2.0.0", integrity: "sha512-DkVaaQHymRhpYEYo9x1oo7Q7B0Y6KJUsjm3c9eTyFDby4MHLBTwZ6ZDWBel5zrYxj1WsZgC5oLpiz+93MluXeA==" },
  "defuddle/node_modules/css-select": { version: "7.0.0", integrity: "sha512-snmjEVXy+1LnwXdxhYvTMj1d9tOh4HxkA1YmoayVBeeyR2C14Pum7fcxJIm4SswYspVy866eYNwlH6xC3/VH5g==" },
  "defuddle/node_modules/css-select/node_modules/domelementtype": { version: "3.0.0", integrity: "sha512-umCQid3jKbDmVjx8jGaW7uUykm4DEUeyV21hPxNMo2nV955DhUThwqyOIDtreepP31hl84X7G5U9ZfsWvIB3Pg==" },
  "defuddle/node_modules/css-select/node_modules/domhandler": { version: "6.0.1", integrity: "sha512-gYzvtM72ZtxQO0T048kd6HWSbbGCNOUwcnfQ01cqIJ4X2IYKFFHZ5mKvrQETcFXxsRObZulDaKmy//R7TPtsBg==" },
  "defuddle/node_modules/css-select/node_modules/domutils": { version: "4.0.2", integrity: "sha512-qI4JLRKnSzqFqr7hAlS5xQDusBCjKSEG4t4+7aNrIQMHBcsC2TGEhuyABJdYkgSewL57PNLYEiibY2iPKhKpaA==" },
  "defuddle/node_modules/css-what": { version: "8.0.0", integrity: "sha512-DH0Bqq3DNp5tdOReuNyAA+Ev4Y2GS5FMbZpeTLP6C4CDi0h5nL0BmUPChXw3o/qbHLDWHl49sbNqQVY7bMSDdw==" },
  "defuddle/node_modules/dom-serializer": { version: "3.1.1", integrity: "sha512-4MEa38/QexBob6gFNwu+EGdWvhJ1OKuNwdYY3Y3NyeWDQfnGeDYQUDfIRzWu5B5gsv03so2Uxd28YC6zrsx3Lw==" },
  "defuddle/node_modules/dom-serializer/node_modules/domelementtype": { version: "3.0.0", integrity: "sha512-umCQid3jKbDmVjx8jGaW7uUykm4DEUeyV21hPxNMo2nV955DhUThwqyOIDtreepP31hl84X7G5U9ZfsWvIB3Pg==" },
  "defuddle/node_modules/dom-serializer/node_modules/domhandler": { version: "6.0.1", integrity: "sha512-gYzvtM72ZtxQO0T048kd6HWSbbGCNOUwcnfQ01cqIJ4X2IYKFFHZ5mKvrQETcFXxsRObZulDaKmy//R7TPtsBg==" },
  "defuddle/node_modules/dom-serializer/node_modules/entities": { version: "8.1.0", integrity: "sha512-kxL7msIffSuh9aaFAMD7rxAIuTRMAHMeBtgHW2yUdWw732ZNh4MehkF2gdjvtdmikkaIP9bFDDJOPlsvm7avrA==" },
  "defuddle/node_modules/entities": { version: "7.0.1", integrity: "sha512-TWrgLOFUQTH994YUyl1yT4uyavY5nNB5muff+RtWaqNVCAK408b5ZnnbNAUEWLTCpum9w6arT70i1XdQ4UeOPA==" },
  "defuddle/node_modules/htmlparser2": { version: "10.1.0", integrity: "sha512-VTZkM9GWRAtEpveh7MSF6SjjrpNVNNVJfFup7xTY3UpFtm67foy9HDVXneLtFVt4pMz5kZtgNcvCniNFb1hlEQ==" },
  "defuddle/node_modules/linkedom": { version: "0.18.13", integrity: "sha512-ES/o9qotMpzpN2MHs+Iq/JcVoOj8Fa5wiQYrTdFpvAnwXL0g66XHHUc9WUMk6nAlBtGsFQ24ne+SYnvnaQ2FSw==" },
  "defuddle/node_modules/nth-check": { version: "3.0.1", integrity: "sha512-GX0gsdbGVCgnRgbeGaubfjpBXyYRWOOCVeYh08bSQvDZqxz5ndXs1OTfAt/h36G1xvI94YIspsI0sVFqAV9+RQ==" },
  "depd": { version: "2.0.0", integrity: "sha512-g7nH6P6dyDioJogAAGprGpCtVImJhpPk/roCzdb3fIh61/s/nPsfR6onyMwkCAR/OlC3yBC0lESvUoQEAssIrw==" },
  "dom-serializer": { version: "2.0.0", integrity: "sha512-wIkAryiqt/nV5EQKqQpo3SToSOV9J0DnbJqwK7Wv/Trc92zIAYZ4FlMu+JPFW1DfGFt81ZTCGgDEabffXeLyJg==" },
  "domelementtype": { version: "2.3.0", integrity: "sha512-OLETBj6w0OsagBwdXnPdN0cnMfF9opN69co+7ZrbfPGrdpPVNBUj02spi6B1N7wChLQiPn4CSH/zJvXw56gmHw==" },
  "domhandler": { version: "5.0.3", integrity: "sha512-cgwlv/1iFQiFnU96XXgROh8xTeetsnJiDsTc7TYCLFd9+/WNkIqPTxiM/8pSd8VIrhXGTf1Ny1q1hquVqDJB5w==" },
  "domutils": { version: "3.2.2", integrity: "sha512-6kZKyUajlDuqlHKVX1w7gyslj9MPIXzIFiz/rGu35uC1wMi+kMhQwGhl4lt9unC9Vb9INnY9Z3/ZA3+FhASLaw==" },
  "dunder-proto": { version: "1.0.1", integrity: "sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==" },
  "ee-first": { version: "1.1.1", integrity: "sha512-WMwm9LhRUo+WUaRN+vRuETqG89IgZphVSNkdFgeb6sS/E4OrDIN7t48CAewSHXc6C8lefD8KKfr5vY61brQlow==" },
  "encodeurl": { version: "2.0.0", integrity: "sha512-Q0n9HRi4m6JuGIV1eFlmvJB7ZEVxu93IrMyiMsGC0lrMJMWzRgx6WGquyfQgZVb31vhGgXnfmPNNXmxnOkRBrg==" },
  "entities": { version: "4.5.0", integrity: "sha512-V0hjH4dGPh9Ao5p0MoRY6BVqtwCjhz6vI5LT8AJ55H+4g9/4vbHx1I54fS0XuclLhDHArPQCiMjDxjaL8fPxhw==" },
  "es-abstract": { version: "1.24.2", integrity: "sha512-2FpH9Q5i2RRwyEP1AylXe6nYLR5OhaJTZwmlcP0dL/+JCbgg7yyEo/sEK6HeGZRf3dFpWwThaRHVApXSkW3xeg==" },
  "es-abstract-get": { version: "1.0.0", integrity: "sha512-6PMWXpdhshVvFp+FoWYs1EvG1Nj0tvk0dZM+XcK0xMEM1czRVcP6ohqPWHy6qPagSpC8j4+p89WXlT+xXJs/fg==" },
  "es-define-property": { version: "1.0.1", integrity: "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==" },
  "es-errors": { version: "1.3.0", integrity: "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==" },
  "es-object-atoms": { version: "1.1.2", integrity: "sha512-HWcBoN6NileqtSydK2FqHbS/LoDd2pqrnQHLyJzBj4kOp/ky2MWMN694xOfkK8/SnUsW2DH7EfyVlydKCsm1Zw==" },
  "es-set-tostringtag": { version: "2.1.0", integrity: "sha512-j6vWzfrGVfyXxge+O0x5sh6cvxAog0a/4Rdd2K36zCMV5eJ+/+tOAngRO8cODMNWbVRdVlmGZQL2YS3yR8bIUA==" },
  "es-to-primitive": { version: "1.3.4", integrity: "sha512-yPDz7wqpg1/mmHLmS3tcfTfbw5f1eryXvyghYBffGdERwe+mV7ZcWzTR8LR17Kvqt3qfPurjlonmnq3MKXIOXw==" },
  "escape-html": { version: "1.0.3", integrity: "sha512-NiSupZ4OeuGwr68lGIeym/ksIZMJodUGOSCZ/FSnTxcrekbvqrgdUxlJOMpijaKZVjAJrWrGs/6Jy8OMuyj9ow==" },
  "etag": { version: "1.8.1", integrity: "sha512-aIL5Fx7mawVa300al2BnEE4iNvo1qETxLrPI/o05L7z6go7fCw1J6EQmbK4FmJ2AS7kgVF/KEZWufBfdClMcPg==" },
  "eventsource": { version: "3.0.7", integrity: "sha512-CRT1WTyuQoD771GW56XEZFQ/ZoSfWid1alKGDYMmkt2yl8UXrVR4pspqWNEcqKvVIzg6PAltWjxcSSPrboA4iA==" },
  "eventsource-parser": { version: "3.1.1", integrity: "sha512-EKN1vKAMcZ8MlYMpaNuxN6R9yakzH6uajHcHVTqWJzvu5pWw9DyhbP35HH8MVBQ+dZjAfDxk+A8NiR9KWaXiyQ==" },
  "express": { version: "5.2.1", integrity: "sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==" },
  "express-rate-limit": { version: "8.7.1", integrity: "sha512-2FXbqkygil3mZiXzEtM0IjE/UBmBNot0J1GEVrJT4JbrvwOSoEtqtO+wHbiMQELWe1eNvHoYRg2dkjOid+6JkA==" },
  "fast-deep-equal": { version: "3.1.3", integrity: "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==" },
  "fast-uri": { version: "3.1.8", integrity: "sha512-GZMtZUTNRpOVIECoXwLNZS5xUGE+mVNbTB8h/7Rwh2TFWcBQiPzTgyZi05BF9UMZKkLJv8XBRJTlU7zg8+ZfMg==" },
  "finalhandler": { version: "2.1.1", integrity: "sha512-S8KoZgRZN+a5rNwqTxlZZePjT/4cnm0ROV70LedRHZ0p8u9fRID0hJUZQpkKLzro8LfmC8sx23bY6tVNxv8pQA==" },
  "for-each": { version: "0.3.5", integrity: "sha512-dKx12eRCVIzqCxFGplyFKJMPvLEWgmNtUrpTiJIR5u97zEhRG8ySrtboPHZXx7daLxQVrl643cTzbab2tkQjxg==" },
  "forwarded": { version: "0.2.0", integrity: "sha512-buRG0fpBtRHSTCOASe6hD258tEubFoRLb4ZNA6NxMVHNw2gOcwHo9wyablzMzOA5z9xA9L1KNjk/Nt6MT9aYow==" },
  "fresh": { version: "2.0.0", integrity: "sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==" },
  "function-bind": { version: "1.1.2", integrity: "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==" },
  "function.prototype.name": { version: "1.2.0", integrity: "sha512-jObKIik1P2QjPHP5nz5BaOtUlfgS0fWo8IUByNXkM+o+02sJOi94em77GwJKQSJ3gfPHdgzLNrHc1uokV4P/ew==" },
  "functions-have-names": { version: "1.2.3", integrity: "sha512-xckBUXyTIqT97tq2x2AMb+g163b5JFysYk0x4qxNFwbfQkmNZoiRHb6sPzI9/QV33WeuvVYBUIiD4NzNIyqaRQ==" },
  "generator-function": { version: "2.0.1", integrity: "sha512-SFdFmIJi+ybC0vjlHN0ZGVGHc3lgE0DxPAT0djjVg+kjOnSqclqmj0KQ7ykTOLP6YxoqOvuAODGdcHJn+43q3g==" },
  "get-intrinsic": { version: "1.3.0", integrity: "sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==" },
  "get-proto": { version: "1.0.1", integrity: "sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==" },
  "get-symbol-description": { version: "1.1.0", integrity: "sha512-w9UMqWwJxHNOvoNzSJ2oPF5wvYcvP7jUvYzhp67yEhTi17ZDBBC1z9pTdGuzjD+EFIqLSYRweZjqfiPzQ06Ebg==" },
  "globalthis": { version: "1.0.4", integrity: "sha512-DpLKbNU4WylpxJykQujfCcwYWiV/Jhm50Goo0wrVILAv5jOr9d+H+UR3PhSCD2rCCEIg0uc+G+muBTwD54JhDQ==" },
  "gopd": { version: "1.2.0", integrity: "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==" },
  "has-bigints": { version: "1.1.0", integrity: "sha512-R3pbpkcIqv2Pm3dUwgjclDRVmWpTJW2DcMzcIhEXEx1oh/CEMObMm3KLmRJOdvhM7o4uQBnwr8pzRK2sJWIqfg==" },
  "has-property-descriptors": { version: "1.0.2", integrity: "sha512-55JNKuIW+vq4Ke1BjOTjM2YctQIvCT7GFzHwmfZPGo5wnrgkid0YQtnAleFSqumZm4az3n2BS+erby5ipJdgrg==" },
  "has-proto": { version: "1.2.0", integrity: "sha512-KIL7eQPfHQRC8+XluaIw7BHUwwqL19bQn4hzNgdr+1wXoU0KKj6rufu47lhY7KbJR2C6T6+PfyN0Ea7wkSS+qQ==" },
  "has-symbols": { version: "1.1.0", integrity: "sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==" },
  "has-tostringtag": { version: "1.0.2", integrity: "sha512-NqADB8VjPFLM2V0VvHUewwwsw0ZWBaIdgo+ieHtK3hasLz4qeCRjYcqfB6AQrBggRKppKF8L52/VqdVsO47Dlw==" },
  "hasown": { version: "2.0.4", integrity: "sha512-T2UbfbBEF32wiepXIsMlTW9+dDYC6wMh/t/vYA4tuOMKqWz/n3vr1NFSxQiyP+zk2mXsoMA/i/7qV6LKut1t1A==" },
  "hono": { version: "4.13.13", integrity: "sha512-CQ46U0ZkAGmbT/4UxdzzGJpacP2IeKgY4a5/tOI9AABbpOMfK739wfDXmv1usCk+3RkKj1hQy4/fjhiwa2xlrA==" },
  "html-escaper": { version: "3.0.3", integrity: "sha512-RuMffC89BOWQoY0WKGpIhn5gX3iI54O6nRA0yC124NYVtzjmFWBIiFd8M0x+ZdX0P9R4lADg1mgP8C7PxGOWuQ==" },
  "htmlparser2": { version: "9.1.0", integrity: "sha512-5zfg6mHUoaer/97TxnGpxmbR7zJtPwIYFMZ/H5ucTlPZhKvtum05yiPK3Mgai3a0DyVxv7qYqoweaEd2nrYQzQ==" },
  "http-errors": { version: "2.0.1", integrity: "sha512-4FbRdAX+bSdmo4AUFuS0WNiPz8NgFt+r8ThgNWmlrjQjt1Q7ZR9+zTlce2859x4KSXrwIsaeTqDoKQmtP8pLmQ==" },
  "iconv-lite": { version: "0.7.3", integrity: "sha512-IKXpvIzjnC9XTAUbVBcMfGS0EPaIXtW6v+zr+RRp+hqULEpo0owZax6wyRwPOJbWbzjYspQwusTsfVr0ifh4uQ==" },
  "inherits": { version: "2.0.4", integrity: "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==" },
  "internal-slot": { version: "1.1.0", integrity: "sha512-4gd7VpWNQNB4UKKCFFVcp1AVv+FMOgs9NKzjHKusc8jTMhd5eL1NqQqOpE0KzMds804/yHlglp3uxgluOqAPLw==" },
  "ip-address": { version: "10.7.3", integrity: "sha512-A1kdq/tSb5QjvKvAMgIoEvDBIgL7qaqVP/jkvSwYYRZ9iEzvPpopxp2wQfu3SuZRHtpHNxMn8Fs0bS+gf5Xmwg==" },
  "ipaddr.js": { version: "1.9.1", integrity: "sha512-0KI/607xoxSToH7GjN1FfSbLoU0+btTicjsQSWQlh/hZykN8KpmMf7uYwPW3R+akZ6R/w18ZlXSHBYXiYUPO3g==" },
  "is-array-buffer": { version: "3.0.5", integrity: "sha512-DDfANUiiG2wC1qawP66qlTugJeL5HyzMpfr8lLK+jMQirGzNod0B12cFB/9q838Ru27sBwfw78/rdoU7RERz6A==" },
  "is-async-function": { version: "2.1.1", integrity: "sha512-9dgM/cZBnNvjzaMYHVoxxfPj2QXt22Ev7SuuPrs+xav0ukGB0S6d4ydZdEiM48kLx5kDV+QBPrpVnFyefL8kkQ==" },
  "is-bigint": { version: "1.1.0", integrity: "sha512-n4ZT37wG78iz03xPRKJrHTdZbe3IicyucEtdRsV5yglwc3GyUfbAfpSeD0FJ41NbUNSt5wbhqfp1fS+BgnvDFQ==" },
  "is-boolean-object": { version: "1.2.2", integrity: "sha512-wa56o2/ElJMYqjCjGkXri7it5FbebW5usLw/nPmCMs5DeZ7eziSYZhSmPRn0txqeW4LnAmQQU7FgqLpsEFKM4A==" },
  "is-callable": { version: "1.2.7", integrity: "sha512-1BC0BVFhS/p0qtw6enp8e+8OD0UrK0oFLztSjNzhcKA3WDuJxxAPXzPuPtKkjEY9UUoEWlX/8fgKeu2S8i9JTA==" },
  "is-data-view": { version: "1.0.2", integrity: "sha512-RKtWF8pGmS87i2D6gqQu/l7EYRlVdfzemCJN/P3UOs//x1QE7mfhvzHIApBTRf7axvT6DMGwSwBXYCT0nfB9xw==" },
  "is-date-object": { version: "1.1.0", integrity: "sha512-PwwhEakHVKTdRNVOw+/Gyh0+MzlCl4R6qKvkhuvLtPMggI1WAHt9sOwZxQLSGpUaDnrdyDsomoRgNnCfKNSXXg==" },
  "is-document.all": { version: "1.0.0", integrity: "sha512-+XSoyS05OdBbhFuELhgTCpFNHkpBOJqtsZfUFFpe5QTw+9Sjbh8zitxhQkYAo6wV7e1Vb8cAPvpCk9jGam/82g==" },
  "is-finalizationregistry": { version: "1.1.1", integrity: "sha512-1pC6N8qWJbWoPtEjgcL2xyhQOP491EQjeUo3qTKcmV8YSDDJrOepfG8pcC7h/QgnQHYSv0mJ3Z/ZWxmatVrysg==" },
  "is-generator-function": { version: "1.1.2", integrity: "sha512-upqt1SkGkODW9tsGNG5mtXTXtECizwtS2kA161M+gJPc1xdb/Ax629af6YrTwcOeQHbewrPNlE5Dx7kzvXTizA==" },
  "is-map": { version: "2.0.3", integrity: "sha512-1Qed0/Hr2m+YqxnM09CjA2d/i6YZNfF6R2oRAOj36eUdS6qIV/huPJNSEpKbupewFs+ZsJlxsjjPbc0/afW6Lw==" },
  "is-negative-zero": { version: "2.0.3", integrity: "sha512-5KoIu2Ngpyek75jXodFvnafB6DJgr3u8uuK0LEZJjrU19DrMD3EVERaR8sjz8CCGgpZvxPl9SuE1GMVPFHx1mw==" },
  "is-number-object": { version: "1.1.1", integrity: "sha512-lZhclumE1G6VYD8VHe35wFaIif+CTy5SJIi5+3y4psDgWu4wPDoBhF8NxUOinEc7pHgiTsT6MaBb92rKhhD+Xw==" },
  "is-promise": { version: "4.0.0", integrity: "sha512-hvpoI6korhJMnej285dSg6nu1+e6uxs7zG3BYAm5byqDsgJNWwxzM6z6iZiAgQR4TJ30JmBTOwqZUw3WlyH3AQ==" },
  "is-regex": { version: "1.2.1", integrity: "sha512-MjYsKHO5O7mCsmRGxWcLWheFqN9DJ/2TmngvjKXihe6efViPqc274+Fx/4fYj/r03+ESvBdTXK0V6tA3rgez1g==" },
  "is-set": { version: "2.0.3", integrity: "sha512-iPAjerrse27/ygGLxw+EBR9agv9Y6uLeYVJMu+QNCoouJ1/1ri0mGrcWpfCqFZuzzx3WjtwxG098X+n4OuRkPg==" },
  "is-shared-array-buffer": { version: "1.0.4", integrity: "sha512-ISWac8drv4ZGfwKl5slpHG9OwPNty4jOWPRIhBpxOoD+hqITiwuipOQ2bNthAzwA3B4fIjO4Nln74N0S9byq8A==" },
  "is-string": { version: "1.1.1", integrity: "sha512-BtEeSsoaQjlSPBemMQIrY1MY0uM6vnS1g5fmufYOtnxLGUZM2178PKbhsk7Ffv58IX+ZtcvoGwccYsh0PglkAA==" },
  "is-symbol": { version: "1.1.1", integrity: "sha512-9gGx6GTtCQM73BgmHQXfDmLtfjjTUDSyoxTCbp5WtoixAhfgsDirWIcVQ/IHpvI5Vgd5i/J5F7B9cN/WlVbC/w==" },
  "is-typed-array": { version: "1.1.15", integrity: "sha512-p3EcsicXjit7SaskXHs1hA91QxgTw46Fv6EFKKGS5DRFLD8yKnohjF3hxoju94b/OcMZoQukzpPpBE9uLVKzgQ==" },
  "is-weakmap": { version: "2.0.2", integrity: "sha512-K5pXYOm9wqY1RgjpL3YTkF39tni1XajUIkawTLUo9EZEVUFga5gSQJF8nNS7ZwJQ02y+1YCNYcMh+HIf1ZqE+w==" },
  "is-weakref": { version: "1.1.1", integrity: "sha512-6i9mGWSlqzNMEqpCp93KwRS1uUOodk2OJ6b+sq7ZPDSy2WuI5NFIxp/254TytR8ftefexkWn5xNiHUNpPOfSew==" },
  "is-weakset": { version: "2.0.4", integrity: "sha512-mfcwb6IzQyOKTs84CQMrOwW4gQcaTOAWJ0zzJCl2WSPDrWk/OzDaImWFH3djXhb24g4eudZfLRozAvPGw4d9hQ==" },
  "isarray": { version: "2.0.5", integrity: "sha512-xHjhDr3cNBK0BzdUJSPXZntQUx/mwMS5Rw4A7lPJ90XGAO6ISP/ePDNuo0vhqOZU+UD5JoodwCAAoZQd3FeAKw==" },
  "isexe": { version: "2.0.0", integrity: "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==" },
  "jose": { version: "6.2.12", integrity: "sha512-9NiFmJEex0sy2Dk58j2UGBSHgUs2ypF9eZSu4L6vjOX3Dp96Sw1F3uL+H+D1sx02jZZdzUT0HgvCy59CuvXcWw==" },
  "json-schema-traverse": { version: "1.0.0", integrity: "sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==" },
  "json-schema-typed": { version: "8.0.2", integrity: "sha512-fQhoXdcvc3V28x7C7BMs4P5+kNlgUURe2jmUT1T//oBRMDrqy1QPelJimwZGo7Hg9VPV3EQV5Bnq4hbFy2vetA==" },
  "linkedom": { version: "0.16.11", integrity: "sha512-WgaTVbj7itjyXTsCvgerpneERXShcnNJF5VIV+/4SLtyRLN+HppPre/WDHRofAr2IpEuujSNgJbCBd5lMl6lRw==" },
  "math-intrinsics": { version: "1.1.0", integrity: "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==" },
  "mathml-to-latex": { version: "1.8.0", integrity: "sha512-gQ0uK3zqB8HwlfaXJkEL5rgaZNbKUiBMmBP/B/W+b+t6KcseLSuYb1b0BjLgS9ZiQa24ePkqTX8/6FaQuDL7wQ==" },
  "media-typer": { version: "1.1.1", integrity: "sha512-yz3xRaG20c6/BOzvYoDaGtPmGscs7YivItZEEqe6GbwNfHuxu9YNmvnEkMzKldAGY4/80pRcQRZSEnhquk9XuQ==" },
  "merge-descriptors": { version: "2.0.0", integrity: "sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==" },
  "mime-db": { version: "1.54.0", integrity: "sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==" },
  "mime-types": { version: "3.0.2", integrity: "sha512-Lbgzdk0h4juoQ9fCKXW4by0UJqj+nOOrI9MJ1sSj4nI8aI2eo1qmvQEie4VD1glsS250n15LsWsYtCugiStS5A==" },
  "ms": { version: "2.1.3", integrity: "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==" },
  "negotiator": { version: "1.1.0", integrity: "sha512-NMPBRMJgiQHjbd8phG3Vebdx4kZ1H121rbl5IkMqeOsahptB9BKo/d7oJ3zTXqTgagn2bWlNSXkh0QUGM31RYg==" },
  "negotiator/node_modules/content-type": { version: "2.1.0", integrity: "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==" },
  "nth-check": { version: "2.1.1", integrity: "sha512-lqjrjmaOoAnWfMmBPL+XNnynZh2+swxiX3WUE0s4yEHI6m+AwrK2UZOimIRl3X/4QctVqS8AiZjFqyOGrMXb/w==" },
  "object-assign": { version: "4.1.1", integrity: "sha512-rJgTQnkUnH1sFw8yT6VSU3zD3sWmu6sZhIseY8VX+GRu3P6F7Fu+JNDoXfklElbLJSnc3FUQHVe4cU5hj+BcUg==" },
  "object-inspect": { version: "1.13.4", integrity: "sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==" },
  "object-keys": { version: "1.1.1", integrity: "sha512-NuAESUOUMrlIXOfHKzD6bpPu3tYt3xvjNdRIQ+FeT0lNb4K8WR70CaDxhuNguS2XG+GjkyMwOzsN5ZktImfhLA==" },
  "object.assign": { version: "4.1.7", integrity: "sha512-nK28WOo+QIjBkDduTINE4JkF/UJJKyf2EJxvJKfblDpyg0Q+pkOHNTL0Qwy6NP6FhE/EnzV73BxxqcJaXY9anw==" },
  "on-finished": { version: "2.4.1", integrity: "sha512-oVlzkg3ENAhCk2zdv7IJwd/QUD4z2RxRwpkcGY8psCVcCYZNq4wYnVWALHM+brtuJjePWiYF/ClmuDr8Ch5+kg==" },
  "once": { version: "1.4.0", integrity: "sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==" },
  "own-keys": { version: "1.0.2", integrity: "sha512-19YVAg7T+WTrxggPukVq7DjTv6+PJ867TmhCvBsYwmbFCsZd344rq2Ld1p0wo8f8Qrrhgp82c6FJRqdXWtSEhg==" },
  "p-limit": { version: "6.2.0", integrity: "sha512-kuUqqHNUqoIWp/c467RI4X6mmyuojY5jGutNU0wVTmEOOfcuwLqyMVoAi9MKi2Ak+5i9+nhmrK4ufZE8069kHA==" },
  "parseurl": { version: "1.3.3", integrity: "sha512-CiyeOxFT/JZyN5m0z9PfXw4SCBJ6Sygz1Dpl0wqjlhDEGGBP1GnsUVEL0p63hoG1fcj3fHynXi9NYO4nWOL+qQ==" },
  "path-key": { version: "3.1.1", integrity: "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==" },
  "path-to-regexp": { version: "8.4.2", integrity: "sha512-qRcuIdP69NPm4qbACK+aDogI5CBDMi1jKe0ry5rSQJz8JVLsC7jV8XpiJjGRLLol3N+R5ihGYcrPLTno6pAdBA==" },
  "pkce-challenge": { version: "5.0.1", integrity: "sha512-wQ0b/W4Fr01qtpHlqSqspcj3EhBvimsdh0KlHhH8HRZnMsEa0ea2fTULOXOS9ccQr3om+GcGRk4e+isrZWV8qQ==" },
  "possible-typed-array-names": { version: "1.1.0", integrity: "sha512-/+5VFTchJDoVj3bhoqi6UeymcD00DAwb1nJwamzPvHEszJ4FpF6SNNbUbOS8yI56qHzdV8eK0qEfOSiodkTdxg==" },
  "promise.try": { version: "2.0.2", integrity: "sha512-v52t0zwjhZX4x52T69jDMO11oKAt6l7NosmY+H+3MD7s16iXUYbFrA+DOcW5rvl+mBIWJAFbbTaExDxPUgaowg==" },
  "proxy-addr": { version: "2.0.8", integrity: "sha512-5nnx0yGyVUcY6t9RnWcARWtwT9F1D8O9rt08htPvnd49W1IgZtmLkhu9WfMzQj1cFxjHIO6connUNVW5k7AVyQ==" },
  "qs": { version: "6.16.0", integrity: "sha512-h6fhOIaRrID2CbEY2fqs+7t+UXZo+MLAnU5gRIq85uFtdiUPCdsApMlHhXogKVM4HM2DVbIjGNTTYH2OcmP1vA==" },
  "range-parser": { version: "1.3.0", integrity: "sha512-hek2mFQpPuI4E1BBKrSto+BU3e3x4xuarsbiwr3+lf7p44juvFMV0XFWQAP3xUyqXA4RrXLIoaSUGbSt056ZMw==" },
  "raw-body": { version: "3.0.2", integrity: "sha512-K5zQjDllxWkf7Z5xJdV0/B0WTNqx6vxG70zJE4N0kBs4LovmEYWJzQGxC9bS9RAKu3bgM40lrd5zoLJ12MQ5BA==" },
  "reflect.getprototypeof": { version: "1.0.10", integrity: "sha512-00o4I+DVrefhv+nX0ulyi3biSHCPDe+yLv5o/p6d/UVlirijB8E16FtfwSAi4g3tcqrQ4lRAqQSoFEZJehYEcw==" },
  "regexp.prototype.flags": { version: "1.5.4", integrity: "sha512-dYqgNSZbDwkaJ2ceRd9ojCGjBq+mOm9LmtXnAnEGyHhN/5R7iDW2TRw3h+o/jCFxus3P2LfWIIiwowAjANm7IA==" },
  "require-from-string": { version: "2.0.2", integrity: "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==" },
  "router": { version: "2.2.0", integrity: "sha512-nLTrUKm2UyiL7rlhapu/Zl45FwNgkZGaCpZbIHajDYgwlJCOzLSk+cIPAnsEqV955GjILJnKbdQC1nVPz+gAYQ==" },
  "safe-array-concat": { version: "1.1.4", integrity: "sha512-wtZlHyOje6OZTGqAoaDKxFkgRtkF9CnHAVnCHKfuj200wAgL+bSJhdsCD2l0Qx/2ekEXjPWcyKkfGb5CPboslg==" },
  "safe-push-apply": { version: "1.0.0", integrity: "sha512-iKE9w/Z7xCzUMIZqdBsp6pEQvwuEebH4vdpjcDWnyzaI6yl6O9FHvVpmGelvEHNsoY6wGblkxR6Zty/h00WiSA==" },
  "safe-regex-test": { version: "1.1.0", integrity: "sha512-x/+Cz4YrimQxQccJf5mKEbIa1NzeCRNI5Ecl/ekmlYaampdNLPalVyIcCZNNH3MvmqBugV5TMYZXv0ljslUlaw==" },
  "safer-buffer": { version: "2.1.2", integrity: "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==" },
  "send": { version: "1.2.1", integrity: "sha512-1gnZf7DFcoIcajTjTwjwuDjzuz4PPcY2StKPlsGAQ1+YH20IRVrBaXSWmdjowTJ6u8Rc01PoYOGHXfP1mYcZNQ==" },
  "serve-static": { version: "2.2.1", integrity: "sha512-xRXBn0pPqQTVQiC8wyQrKs2MOlX24zQ0POGaj0kultvoOCstBQM5yvOhAVSUwOMjQtTvsPWoNCHfPGwaaQJhTw==" },
  "set-function-length": { version: "1.2.2", integrity: "sha512-pgRc4hJ4/sNjWCSS9AmnS40x3bNMDTknHgL5UaMBTMyJnU90EgWh1Rz+MC9eFu4BuN/UwZjKQuY/1v3rM7HMfg==" },
  "set-function-name": { version: "2.0.2", integrity: "sha512-7PGFlmtwsEADb0WYyvCMa1t+yke6daIG4Wirafur5kcf+MhUnPms1UeR0CKQdTZD81yESwMHbtn+TR+dMviakQ==" },
  "set-proto": { version: "1.0.0", integrity: "sha512-RJRdvCo6IAnPdsvP/7m6bsQqNnn1FCBX5ZNtFL98MmFF/4xAIJTIg1YbHW5DC2W5SKZanrC6i4HsJqlajw/dZw==" },
  "setprototypeof": { version: "1.2.0", integrity: "sha512-E5LDX7Wrp85Kil5bhZv46j8jOeboKq5JMmYM3gVGdGH8xFpPWXUMsNrlODCrkoxMEeNi/XZIwuRvY4XNwYMJpw==" },
  "shebang-command": { version: "2.0.0", integrity: "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==" },
  "shebang-regex": { version: "3.0.0", integrity: "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==" },
  "side-channel": { version: "1.1.1", integrity: "sha512-6x6dK6zJdpTzF4sQeNYxwtvBzf6Eg4GtlesS94HOvTudUeyK2WXAaIfmDgsyslYrRBeFIlsi54AYsFGUuhmvrQ==" },
  "side-channel-list": { version: "1.0.1", integrity: "sha512-mjn/0bi/oUURjc5Xl7IaWi/OJJJumuoJFQJfDDyO46+hBWsfaVM65TBHq2eoZBhzl9EchxOijpkbRC8SVBQU0w==" },
  "side-channel-map": { version: "1.0.1", integrity: "sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==" },
  "side-channel-weakmap": { version: "1.0.2", integrity: "sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==" },
  "statuses": { version: "2.0.2", integrity: "sha512-DvEy55V3DB7uknRo+4iOGT5fP1slR8wQohVdknigZPMpMstaKJQWhwiYBACJE3Ul2pTnATihhBYnRhZQHGBiRw==" },
  "stop-iteration-iterator": { version: "1.1.0", integrity: "sha512-eLoXW/DHyl62zxY4SCaIgnRhuMr6ri4juEYARS8E6sCEqzKpOiE521Ucofdx+KnDZl5xmvGYaaKCk5FEOxJCoQ==" },
  "string.prototype.trim": { version: "1.2.11", integrity: "sha512-PwvK7BU+CMTJGYQCTZb5RWXIML92lftJLhQz1tBzgKiqGxJaMlBAa48POXaNAC2s4y8jr3EFqrkF9+44neS46w==" },
  "string.prototype.trimend": { version: "1.0.10", integrity: "sha512-2+3aDAOmPTmuFwjDnmJG2ctEkQKVki7vOSqaxkv42Mowj1V6PnvuwFCRrR5lChUux1TBskPjfkeTOhqczDMxTw==" },
  "string.prototype.trimstart": { version: "1.0.8", integrity: "sha512-UXSH262CSZY1tfu3G3Secr6uGLCFVPMhIqHjlgCUtCCcgihYc/xKs9djMTMUOb2j1mVSeU8EU6NWc/iQKU6Gfg==" },
  "temml": { version: "0.13.5", integrity: "sha512-aPkDDgunanpLNL0ql32HbolqLep+w8DRcVXRql7rWrMt/PhczdLgL4UBYYVU3BYjCNjkGq4EqwIicu/zWr1iOg==" },
  "toidentifier": { version: "1.0.1", integrity: "sha512-o5sSPKEkg/DIQNmH43V0/uerLrpzVedkUh8tGNvaeXpfpuwjKenlSox/2O/BTlZUtEe+JG7s5YhEz608PlAHRA==" },
  "turndown": { version: "7.2.4", integrity: "sha512-I8yFsfRzmzK0WV1pNNOA4A7y4RDfFxPRxb3t+e3ui14qSGOxGtiSP6GjeX+Y6CHb7HYaFj7ECUD7VE5kQMZWGQ==" },
  "type-is": { version: "2.1.0", integrity: "sha512-faYHw0anBbc/kWF3zFTEnxSFOAGUX9GFbOBthvDdLsIlEoWOFOtS0zgCiQYwIskL9iGXZL3kAXD8OoZ4GmMATA==" },
  "type-is/node_modules/content-type": { version: "2.1.0", integrity: "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==" },
  "typed-array-buffer": { version: "1.0.3", integrity: "sha512-nAYYwfY3qnzX30IkA6AQZjVbtK6duGontcQm1WSG1MD94YLqK0515GNApXkoxKOWMusVssAHWLh9SeaoefYFGw==" },
  "typed-array-byte-length": { version: "1.0.3", integrity: "sha512-BaXgOuIxz8n8pIq3e7Atg/7s+DpiYrxn4vdot3w9KbnBhcRQq6o3xemQdIfynqSeXeDrF32x+WvfzmOjPiY9lg==" },
  "typed-array-byte-offset": { version: "1.0.5", integrity: "sha512-0FHJvLPqZ7KJzp17O13jfsAjsqazgrxBu2zEK95PmUz8lv2+GjRuxUInCr2Rk9Dms3ihN21zJ929ZO43yJ95QQ==" },
  "typed-array-length": { version: "1.0.8", integrity: "sha512-phPGCwqr2+Qo0fwniCE8e4pKnGu/yFb5nD5Y8bf0EEeiI5GklnACYA9GFy/DrAeRrKHXvHn+1SUsOWgJp6RO+g==" },
  "uhyphen": { version: "0.2.0", integrity: "sha512-qz3o9CHXmJJPGBdqzab7qAYuW8kQGKNEuoHFYrBwV6hWIMcpAmxDLXojcHfFr9US1Pe6zUswEIJIbLI610fuqA==" },
  "unbox-primitive": { version: "1.1.0", integrity: "sha512-nWJ91DjeOkej/TA8pXQ3myruKpKEYgqvpw9lz4OPHj/NWFNluYrjbz9j01CJ8yKQd2g4jFoOkINCTW2I5LEEyw==" },
  "undici": { version: "8.11.2", integrity: "sha512-u4UB2/IrKdU6lFxumHmmo1a3fCQO5tzQllRorfoRS63txhrB7xTpSn1PftwC4qEHkOaqP95fCWW4lJzwErwzhQ==" },
  "unpdf": { version: "1.8.1", integrity: "sha512-xkURhy2SoGpOIH0a1gLHNkASPIQYonadDJs2AQwPEfUakafeD9EA1WTWWsaR++gfTCXJpV27W7tU1nXuk82UKQ==" },
  "unpipe": { version: "1.0.0", integrity: "sha512-pjy2bYhSsufwWlKwPc+l3cN7+wuJlK6uz0YdJEOlQDbl6jo/YlPi4mb8agUkVC8BF7V8NuzeyPNqRksA3hztKQ==" },
  "vary": { version: "1.1.2", integrity: "sha512-BNGbWLfd0eUPabhkXUVm0j8uuvREyTh5ovRa/dyow/BqAbZJyC+5fU+IzQOzmAKzYqYRAISoRhdQr3eIZ/PXqg==" },
  "which": { version: "2.0.2", integrity: "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==" },
  "which-boxed-primitive": { version: "1.1.1", integrity: "sha512-TbX3mj8n0odCBFVlY8AxkqcHASw3L60jIuF8jFP78az3C2YhmGvqbHBpAjTRH2/xqYunrJ9g1jSyjCjpoWzIAA==" },
  "which-builtin-type": { version: "1.2.1", integrity: "sha512-6iBczoX+kDQ7a3+YJBnh3T+KZRxM/iYNPXicqk66/Qfm1b93iu+yOImkg0zHbj5LNOcNv1TEADiZ0xa34B4q6Q==" },
  "which-collection": { version: "1.0.2", integrity: "sha512-K4jVyjnBdgvc86Y6BkaLZEN933SwYOuBFkdmBu9ZfkcAbdVbpITnDmjvZ/aQjRXQrv5EPkTnD1s39GiiqbngCw==" },
  "which-typed-array": { version: "1.1.24", integrity: "sha512-wk4Mf4pR5mRP7eYuuTBCIQ9d0ud2Fv2jRLQpfgnRjbOxAFHmjKFValgTpitVKzJJS8ajnYQV2Du1SZ8j6b/EUQ==" },
  "wrappy": { version: "1.0.2", integrity: "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==" },
  "yocto-queue": { version: "1.2.2", integrity: "sha512-4LCcse/U2MHZ63HAJVE+v71o7yOdIe4cZ70Wpf8D/IyjDKYQLV5GD46B+hSTjJsvV5PztjvHoU580EftxjDZFQ==" },
  "zod": { version: "4.6.5", integrity: "sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==" },
  "zod-to-json-schema": { version: "3.25.2", integrity: "sha512-O/PgfnpT1xKSDeQYSCfRI5Gy3hPf91mKVDuYLUHZJMiDFptvP41MSnWofm8dnCm0256ZNfZIM7DSzuSMAFnjHA==" },
});

/** The bounds OMA's adapter needs inside the vendored sources, written as
 * exact-once text splices over the post-rewrite tsc emit. upstream/ stays
 * the byte-exact npm snapshot; runtime/ carries these and only these edits
 * (plus the mechanical specifier rewrite, which is not semantic). Anchors
 * quote the emitted source verbatim: each `find` must occur exactly once
 * or the regeneration fails instead of emitting a partially patched
 * runtime.
 *
 * OMA installs capability flags before registration. The four eager tools
 * retain their names, while Human command/workflow/fetch/proxy settings and
 * local-network access work. Credential cookie/keyring/local-file boundaries
 * remain separately guarded; allowed clone, gh, media and curator paths use
 * upstream implementations. Every change below binds one emitted anchor.
 */
const OMA_DIVERGENCES = Object.freeze({
  "utils.js": {
    reason:
      "OMA web-policy seam and egress pin. The adapter installs the " +
      "Society contract { egressPinned } before upstream's factory runs; " +
      "OMA capability flags retain separate credential boundaries. Network " +
      "access accepts local destinations and ordinary configured/per-call proxies. " +
      "Upstream owns scoped proxy transport and NO_PROXY; the verified undici " +
      "dispatcher handles the deployment's environment proxy.",
    edits: [
      {
        find: `const proxyStorage = new AsyncLocalStorage();`,
        replace: `// OMA divergence (applied by scripts/vendor-pi-web-access.mjs; recorded
// under generated.divergences in manifest.json): the OMA web policy. The
// adapter installs the deployment's Society contract before upstream's
// extension factory runs. omaPermits is deny-by-default: a flag is open
// only when an installed policy sets it true, so an ambient-discovery
// escape (a \`!command\` credential source, browser cookies, the gh CLI,
// a local file fetch, a curator workflow) stays closed even if vendored
// code were ever evaluated without the adapter's install.
let omaPolicy;
/** Install the OMA web policy. Passing undefined restores the
 * deny-by-default posture (every permit flag reads false). */
export function omaInstallWebPolicy(policy) {
    omaPolicy = policy;
    omaPinnedNormalized = undefined;
}
/** The installed policy, or undefined when none was installed. */
export function omaWebPolicy() {
    return omaPolicy;
}
/** Deny-by-default permit check: true only when an installed policy sets
 * the named flag true. */
export function omaPermits(flag) {
    return omaPolicy !== undefined && omaPolicy[flag] === true;
}
let omaPinnedNormalized;
/** The deployment's egress pin as URL.toString() (the form
 * normalizeProxyUrl produces), or null when no policy is installed or
 * the policy pins no proxy. */
export function omaEgressPinnedProxy() {
    if (omaPolicy === undefined || omaPolicy.egressPinned === null)
        return null;
    if (omaPinnedNormalized === undefined)
        omaPinnedNormalized = new URL(omaPolicy.egressPinned).toString();
    return omaPinnedNormalized;
}
const proxyStorage = new AsyncLocalStorage();`,
      },
      {
        find: `import { join } from "node:path";`,
        replace: `import { join } from "node:path";
// OMA divergence: the egress dispatcher the adapter installs is the
// bundle's own vendored undici. Re-export the two symbols through this
// policy-seam module so the adapter never imports the bundle's
// node_modules itself -- every dynamic specifier it writes stays a
// runtime/ path inside the verified payload.
export { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";`,
      },
    ],
  },
  "ssrf-protection.js": {
    reason:
      "Egress-aware SSRF preflight: when the OMA egress pin exists the " +
      "request is carried by the env proxy the pin names, so the " +
      "local-DNS preflight is skipped exactly as upstream skips it for a " +
      "configured remote-DNS proxy — the CONNECT allowlist is the " +
      "authoritative screen, and a sandboxed engine could not resolve " +
      "names locally anyway. The pin takes the place of 'the configured " +
      "proxy' for that comparison.",
    edits: [
      {
        find: `    if (!hostname)
        throw new Error("URL must include a hostname");`,
        replace: `    if (!hostname)
        throw new Error("URL must include a hostname");
    // The Human authorized full network access, including local development services.
    // Keep URL grammar and the Human's explicit domain policy on every redirect.
    if (omaWebPolicy() !== undefined) {
        assertDomainPolicy(hostname, options.domainPolicy);
        return url;
    }`,
      },
      {
        find: `import { getActiveProxy, getWebSearchConfigPath, hasScopedProxyDecision, isProxyBypassedUrl, loadConfiguredProxy, normalizeProxyUrl } from "./utils.js";`,
        replace: `import { getActiveProxy, getWebSearchConfigPath, hasScopedProxyDecision, isProxyBypassedUrl, loadConfiguredProxy, normalizeProxyUrl, omaEgressPinnedProxy, omaWebPolicy } from "./utils.js";`,
      },
      {
        find: `    const trustProxy = options.trustEnvProxy === true;`,
        replace: `    // OMA divergence: an installed egress pin means the env proxy is
    // the route — trust it for hostname resolution the way upstream
    // trusts a configured remote-DNS proxy.
    const trustProxy = options.trustEnvProxy === true || omaEgressPinnedProxy() !== null;`,
      },
      {
        find: `        proxy === loadConfiguredProxy();`,
        replace: `        // OMA divergence: under an installed policy the egress pin is the
        // one proxy normalizeProxyUrl will ever pass, so it is "the
        // configured proxy" for the remote-DNS skip.
        proxy === (omaEgressPinnedProxy() ?? loadConfiguredProxy());`,
      },
    ],
  },
  "credential-source.js": {
    reason:
      "Credential command refusal: upstream executes a `!command` source " +
      "to resolve a credential; OMA's credential boundary forbids " +
      "extension-driven subprocesses on credential paths, so under the " +
      "deny-by-default permit the source refuses before any shell runs. " +
      "Literal, $ENV and file config sources keep upstream's semantics — " +
      "what they can see is the engine's own allowlisted environment and " +
      "the OMA-owned config file, not the host's credential stores.",
    edits: [
      {
        find: `import { exec } from "node:child_process";`,
        replace: `import { exec } from "node:child_process";
import { omaPermits } from "./utils.js";`,
      },
      {
        find: `    if (source?.startsWith("!")) {`,
        replace: `    // OMA divergence: a \`!command\` credential source would run a
    // shell on a credential path. Refuse before any subprocess starts --
    // the permit flag is deny-by-default, so the refusal holds even if
    // this module is evaluated without the adapter's policy install.
    if (source?.startsWith("!") && !omaPermits("credentialCommands"))
        throw new Error("[E_OMA_COMMAND_CREDENTIAL] command credential sources are not permitted under OMA; configure a literal or $ENV value in the OMA-owned web-search.json");
    if (source?.startsWith("!")) {`,
      },
    ],
  },
  "gemini-web-config.js": {
    reason:
      "Browser cookie refusal: upstream's opt-in browser-cookie access " +
      "(env or config) reaches Chrome-family cookie stores and the " +
      "Keychain/secret-tool decryptors behind them. OMA forbids that " +
      "ambient credential discovery outright — this one gate covers " +
      "gemini-web, authenticated fetch profiles and /google-account.",
    edits: [
      {
        find: `import { getWebSearchConfigPath } from "./utils.js";`,
        replace: `import { getWebSearchConfigPath, omaPermits } from "./utils.js";`,
      },
      {
        find: `export function isBrowserCookieAccessAllowed() {`,
        replace: `export function isBrowserCookieAccessAllowed() {
    // OMA divergence: browser cookies are the host's credential store.
    // Deny-by-default -- no env or config can open the cookie paths
    // (including the Keychain/secret-tool/kwallet decryptor spawns)
    // under OMA.
    if (!omaPermits("browserCookies"))
        return false;`,
      },
    ],
  },
  "github-api.js": {
    reason:
      "gh CLI refusal: `gh` is the host's authenticated credential " +
      "store — `gh api`/`gh repo clone` would run with the user's GitHub " +
      "token. Under the deny-by-default permit checkGhAvailable returns " +
      "false, so every call site takes upstream's public REST / " +
      "anonymous-git fallback instead.",
    edits: [
      {
        find: `import { execFile } from "node:child_process";`,
        replace: `import { execFile } from "node:child_process";
import { omaPermits } from "./utils.js";`,
      },
      {
        find: `export async function checkGhAvailable(signal) {`,
        replace: `export async function checkGhAvailable(signal) {
    // OMA divergence: the gh CLI is host credential discovery -- its
    // token reaches private repos the public fallbacks cannot. Refuse
    // it outright (deny-by-default) so every caller takes upstream's
    // anonymous path.
    if (!omaPermits("ghCli"))
        return false;`,
      },
    ],
  },
  "github-extract.js": {
    reason:
      "Git clone refusal: upstream's repository path spawns gh/git " +
      "clones into a host-visible clone root (/tmp/pi-github-repos by " +
      "default) with detached process groups — a subprocess plus a write " +
      "outside the agent's owned state. Under the deny-by-default permit " +
      "the clone path returns null, so GitHub URLs take upstream's " +
      "subprocess-free API view and the generic fetch fallback.",
    edits: [
      {
        find: `import { getWebSearchConfigPath } from "./utils.js";`,
        replace: `import { getWebSearchConfigPath, omaPermits } from "./utils.js";`,
      },
      {
        find: `    const config = loadGitHubConfig();
    if (!config.enabled)
        return null;`,
        replace: `    const config = loadGitHubConfig();
    // OMA divergence: the clone path is a git/gh subprocess writing into
    // a host-visible clone root (/tmp by default). OMA's web tools are
    // remote-only -- deny-by-default keeps every GitHub URL on the
    // subprocess-free API path (and the generic fetch fallback) even if
    // this module is evaluated without the adapter's install.
    if (!omaPermits("gitClone"))
        return null;
    if (!config.enabled)
        return null;`,
      },
    ],
  },
  "youtube-extract.js": {
    reason:
      "Native media refusal: the YouTube path shells out to yt-dlp and " +
      "ffmpeg and feeds the description through a model call. Under the " +
      "deny-by-default permit isYouTubeURL reports no video and " +
      "isYouTubeEnabled reports disabled — every caller (the main " +
      "extractor and the frame/timestamp paths that bypass the enabled " +
      "check) falls through to the generic remote fetch or an honest " +
      "unsupported-feature error.",
    edits: [
      {
        find: `import { formatSeconds, readExecError, isTimeoutError, trimErrorText, mapFfmpegError, getWebSearchConfigPath } from "./utils.js";`,
        replace: `import { formatSeconds, readExecError, isTimeoutError, trimErrorText, mapFfmpegError, getWebSearchConfigPath, omaPermits } from "./utils.js";`,
      },
      {
        find: `export function isYouTubeURL(url) {`,
        replace: `export function isYouTubeURL(url) {
    // OMA divergence: the YouTube pipeline is a yt-dlp/ffmpeg subprocess
    // plus a model-completion describe pass -- surfaces OMA does not
    // expose. Deny-by-default: no URL classifies as YouTube under OMA, so
    // the main extractor and the frame/timestamp paths all fall through.
    if (!omaPermits("nativeMedia"))
        return { isYouTube: false, videoId: null };`,
      },
      {
        find: `export function isYouTubeEnabled() {
    return loadYouTubeConfig().enabled;
}`,
        replace: `export function isYouTubeEnabled() {
    // OMA divergence: deny-by-default even if a caller skips isYouTubeURL.
    return omaPermits("nativeMedia") === true && loadYouTubeConfig().enabled;
}`,
      },
    ],
  },
  "gemini-adc.js": {
    reason:
      "ADC discovery refusal: upstream probes the host's Google " +
      "Application Default Credentials (~/.config/gcloud/...) to decide " +
      "whether the Vertex path exists. Under the deny-by-default permit " +
      "isGeminiAdcAvailable reports false — no host credential file is " +
      "ever consulted; a Gemini API key configured in the OMA-owned " +
      "web-search.json or engine env keeps working.",
    edits: [
      {
        find: `import { getWebSearchConfigPath } from "./utils.js";`,
        replace: `import { getWebSearchConfigPath, omaPermits } from "./utils.js";`,
      },
      {
        find: `    return existsSync(getAdcPath());`,
        replace: `    // OMA divergence: probing the host's ADC file is host credential
    // discovery. Deny-by-default -- no env or config can arm the Vertex
    // path's ADC probe under OMA; an explicit geminiApiKey source still
    // works exactly as upstream.
    return omaPermits("geminiAdc") === true && existsSync(getAdcPath());`,
      },
    ],
  },
  "video-extract.js": {
    reason:
      "Local file refusal: upstream lets fetch_content take a local path " +
      "or file:// URL into the ffprobe/ffmpeg video pipeline — a model " +
      "naming a host file for a subprocess read. Under the deny-by-" +
      "default permit the input is never a file path, so file:// and " +
      "local paths fall through to the remote-URL validation, which " +
      "refuses non-http(s) inputs.",
    edits: [
      {
        find: `import { activityMonitor } from "./activity.js";`,
        replace: `import { activityMonitor } from "./activity.js";
import { omaPermits } from "./utils.js";`,
      },
      {
        find: `    const isFilePath = input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("file://");`,
        replace: `    // OMA divergence: a local file is a filesystem read through a
    // subprocess pipeline (ffprobe/ffmpeg). The web tools are remote-
    // only; deny-by-default keeps file paths out even if the module is
    // evaluated without the adapter's install.
    const isFilePath = omaPermits("localFileFetch") && (input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("file://"));`,
      },
    ],
  },
  "curator-server.js": {
    reason:
      "Post-listen 'error' absorption: upstream removes its only 'error' " +
      "listener after a successful listen, so an accept-class error " +
      "(EMFILE/ENFILE) later meets zero listeners and escapes the emit " +
      "as the hosting engine's death. A permanent listener beside the " +
      "startup once-listener journals best-effort and keeps the curator " +
      "socket bound for the kernel to retry — the startup rejection " +
      "contract is unchanged, and the class is closed even if the server " +
      "ever runs under an evaluation the workflow pin did not reach.",
    edits: [
      {
        find: `        server.once("error", onError);`,
        replace: `        // OMA divergence (applied by scripts/vendor-pi-web-access.mjs; recorded
        // under generated.divergences in manifest.json): a permanent 'error'
        // listener beside the startup once-listener below. Once that
        // once-listener is removed after a successful listen, an accept-
        // class error (EMFILE/ENFILE) meets zero 'error' listeners and
        // escapes its emit as the hosting engine's death. The journal is
        // best-effort -- a dead stderr must not throw out of the emit
        // either -- and the socket stays bound for the kernel to retry.
        server.on("error", (listenerError) => {
            try {
                console.error(\`Curator server listener error: \${listenerError instanceof Error ? listenerError.message : String(listenerError)}\`);
            }
            catch {
            }
        });
        server.once("error", onError);`,
      },
    ],
  },
  "curator-run.js": {
    reason: "Workflow capability guard: upstream workflow settings run when the installed OMA policy permits workflows.",
    edits: [
      {
        find: `export function resolveWebSearchWorkflow(input, hasUI) {`,
        replace: `import { omaPermits } from "./utils.js";
export function resolveWebSearchWorkflow(input, hasUI) {
    // OMA divergence: the curator workflows are a model-completion and
    // browser surface OMA does not expose. Deny-by-default: no request
    // value, config default or curator state resolves to anything but
    // "none" under OMA.
    if (!omaPermits("workflows"))
        return "none";`,
      },
    ],
  },
  "index.js": {
    reason: "Eager four-tool surface overlay. Human workflow, command, fetch, proxy and provider settings remain effective.",
    edits: [
      {
        find: `import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, resolveCuratorNetworkConfig, runWithProxy } from "./utils.js";`,
        replace: `import { formatSeconds, getWebSearchConfigDir, getWebSearchConfigPath, resolveCuratorNetworkConfig, runWithProxy, omaWebPolicy } from "./utils.js";`,
      },
      {
        find: `function loadConfigForExtensionInit() {`,
        replace: `// OMA divergence (applied by scripts/vendor-pi-web-access.mjs; recorded
// under generated.divergences in manifest.json): the Society surface
// contract. Under an installed policy the loaded config is overlaid so
// the registration below always lands on the same surface: eager
// registration (toolActivation "dynamic"/"auto" is upstream's lazy
// web_enable loader — the dynamic tool APIs are OMA's surface's own
// domain), the four default tool names (the surface plan names them — a
// rename would only fail the startup check), all four tools enabled,
// Human command/workflow/fetch settings, including answer mode, stay effective.
// Everything else in the config — provider, ssrf,
// domain policy, allowed providers, routing — stays the Human's own.
function omaOverlayInitConfig(config) {
    return {
        ...config,
        toolActivation: "eager",
        toolNames: undefined,
        tools: undefined,
        webSearch: { ...config.webSearch, enabled: true },

    };
}
function loadConfigForExtensionInit() {`,
      },
      {
        find: `        return loadConfig();
    }
    catch (err) {`,
        replace: `        return omaWebPolicy() !== undefined ? omaOverlayInitConfig(loadConfig()) : loadConfig();
    }
    catch (err) {`,
      },
    ],
  },
  "utils.d.ts": {
    reason:
      "Declarations for the utils.js OMA policy seam (see the .js " +
      "divergence) so the adapter's install call and the sibling seam " +
      "imports type-check under NodeNext.",
    edits: [
      {
        find: `export declare function normalizeProxyUrl(`,
        replace: `/** OMA divergence: the web policy the adapter installs before the
 * vendored extension factory runs. */
export interface OmaWebPolicy {
    /** The deployment's egress pin (the loopback CONNECT forwarder URL),
     * or null when no proxy value is permitted at all. */
    readonly egressPinned: string | null;
    /** Deny-by-default ambient-discovery permits; all unset under
     * Society's install. */
    readonly credentialCommands?: boolean;
    readonly browserCookies?: boolean;
    readonly ghCli?: boolean;
    readonly gitClone?: boolean;
    readonly geminiAdc?: boolean;
    readonly nativeMedia?: boolean;
    readonly localFileFetch?: boolean;
    readonly workflows?: boolean;
}
export declare function omaInstallWebPolicy(policy: OmaWebPolicy | undefined): void;
export declare function omaWebPolicy(): OmaWebPolicy | undefined;
export declare function omaPermits(flag: keyof OmaWebPolicy & string): boolean;
export declare function omaEgressPinnedProxy(): string | null;
export declare function normalizeProxyUrl(`,
      },
      {
        find: `export declare function getWebSearchConfigDir(): string;`,
        replace: `/** OMA divergence: mirrors the utils.js re-export — the vendored
 * undici's dispatcher surface so the adapter installs the egress agent
 * without an import specifier into the bundle's node_modules. */
export { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
export declare function getWebSearchConfigDir(): string;`,
      },
    ],
  },
});

/** Every upstream .ts module the runtime emits — upstream's whole flat
 * module set, no exclusions: index.ts is the extension entry the adapter
 * drives, and its import graph covers the rest. A new upstream module
 * fails the emit-set check rather than being silently picked up. */
function runtimeModules() {
  return readdirSync(UPSTREAM_DIR)
    .filter(name => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort();
}

/** The expected emitted file set: one .js + one .d.ts per module plus the
 * ambient promise-try declaration upstream ships (verbatim copy). A
 * surprise file — or a missing one — is a regeneration failure, not a
 * partial runtime. */
function expectedEmit(modules) {
  const out = modules.flatMap(name => [name.replace(/\.ts$/, ".js"), name.replace(/\.ts$/, ".d.ts")]);
  out.push("promise-try.d.ts");
  return out.sort();
}

const SPECIFIER_TS = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\.ts\2/g;

/** Upstream writes sibling imports as "./x.ts". Node's loader needs the
 * emitted "./x.js", and tsc will not emit .js while .ts specifiers stand
 * (allowImportingTsExtensions forbids emit), so the staged source copy
 * carries the rewrite before compile. Any "./x" that is not ".ts" — an
 * extensionless or directory specifier — fails here: the upstream import
 * convention changed and this rewrite must be re-derived, not guessed. */
function rewriteSourceSpecifiers(name, text) {
  const next = text.replace(SPECIFIER_TS, (_m, head, quote, spec) => `${head}${quote}${spec}.js${quote}`);
  // After the rewrite every relative specifier must be the emitted
  // ".js" form -- an extensionless, directory, or other specifier means
  // upstream's import convention changed and this rewrite must be
  // re-derived, not guessed.
  const leftover = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/(?![^"']+\.js["'])[^"']+)\2/;
  const bad = next.match(leftover);
  if (bad) throw new Error(`upstream ${name} holds a non-.ts relative specifier: ${bad[0]}`);
  return next;
}

/** Compile the vendored modules with the repository's own tsc and
 * upstream's own compiler options (module ESNext + moduleResolution
 * bundler — upstream/tsconfig.json in the source repo), from a staged
 * copy whose ".ts" specifiers are already ".js". The staging dir sits
 * inside the bundle so module resolution finds the vendored
 * node_modules/ first and the repo root's host API (@earendil-works/*,
 * typebox) behind it. Diagnostics do not stop the emit — a missing
 * ambient type (turndown ships none) is a warning surface, while the
 * emitted-set check below is the completeness proof. */
function emitRuntime(outDir) {
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const modules = runtimeModules();
  const staged = mkdtempSync(join(BUNDLE_DIR, ".emit-stage-"));
  try {
    for (const name of modules)
      writeFileSync(join(staged, name), rewriteSourceSpecifiers(name, readFileSync(join(UPSTREAM_DIR, name), "utf8")));
    copyFileSync(join(UPSTREAM_DIR, "promise-try.d.ts"), join(staged, "promise-try.d.ts"));
    const result = spawnSync(process.execPath, [
      tsc, ...modules.map(name => join(staged, name)), join(staged, "promise-try.d.ts"),
      "--outDir", outDir, "--rootDir", staged,
      "--declaration", "--target", "esnext", "--module", "esnext",
      "--moduleResolution", "bundler", "--strict", "--skipLibCheck",
      "--esModuleInterop", "--isolatedModules", "--types", "node",
    ], { cwd: root, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL" });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`tsc killed by ${result.signal}`);
    // The ambient declaration upstream ships — verbatim copy, part of the
    // emitted set.
    copyFileSync(join(UPSTREAM_DIR, "promise-try.d.ts"), join(outDir, "promise-try.d.ts"));
    const emitted = filesUnder(outDir);
    const expected = expectedEmit(modules);
    if (JSON.stringify(emitted) !== JSON.stringify(expected))
      throw new Error(`tsc emit mismatch: got [${emitted.join(", ")}]\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.status !== 0)
      process.stderr.write(`pi-web-access emit diagnostics (emit completed; the emitted set matched):\n${(result.stdout ?? "").slice(0, 4000)}\n`);
    applyDivergences(outDir, OMA_DIVERGENCES);
    return emitted;
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

function packageMetadata() {
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (pkg.name !== EXPECTED_PACKAGE.name || pkg.version !== EXPECTED_PACKAGE.version)
    throw new Error(`upstream/package.json is not ${EXPECTED_PACKAGE.name}@${EXPECTED_PACKAGE.version}`);
  return {
    name: EXPECTED_PACKAGE.name,
    version: EXPECTED_PACKAGE.version,
    license: pkg.license ?? "MIT",
    repository: pkg.repository?.url ?? "git+https://github.com/nicobailon/pi-web-access.git",
    commit: EXPECTED_PACKAGE.commit,
    npm: {
      tarball: `https://registry.npmjs.org/pi-web-access/-/pi-web-access-${EXPECTED_PACKAGE.version}.tgz`,
      integrity: EXPECTED_PACKAGE.npmIntegrity,
      shasum: EXPECTED_PACKAGE.npmShasum,
    },
  };
}

/** The manifest's own words, compared against what this script would
 * declare today: the divergence table must equal OMA_DIVERGENCES (reason
 * text and edit count), package.* must equal the pinned upstream identity,
 * and the dependency table must equal DEPENDENCIES. A regenerated or
 * hand-edited manifest that drifted from the declared pins fails --check
 * even when every file record and the bundle digest still match. Exported
 * so the regression test can drive the same function the check runs. */
export function manifestMetadataProblems(manifest) {
  const problems = [...divergenceProblems(manifest, OMA_DIVERGENCES), ...vendorPackagingProblems(manifest, BUNDLE_DIR)];
  const expectedPackage = packageMetadata();
  if (canonical(manifest?.package) !== canonical(expectedPackage))
    problems.push("manifest package does not match the pinned upstream identity");
  if (canonical(manifest?.generated?.dependencies) !== canonical(DEPENDENCIES))
    problems.push("manifest generated.dependencies does not match the pinned dependency closure");
  return problems;
}

/** The vendored dependency closure's identity half: every declared
 * package's vendored package.json must carry the pinned version (and a
 * package name equal to the leaf of its vendored path). (Bytes are bound
 * by manifest.files + bundleSha256; this guards the pin table itself.) */
function dependencyProblems() {
  const problems = [];
  for (const [path, pin] of Object.entries(DEPENDENCIES)) {
    const segments = path.split("/");
    // The package name is the last path segment, plus the scope segment
    // before it when the leaf is scoped.
    const leaf = segments[segments.length - 1];
    const expectedName = segments.length > 1 && segments[segments.length - 2].startsWith("@")
      ? `${segments[segments.length - 2]}/${leaf}` : leaf;
    const pkgPath = join(BUNDLE_DIR, "node_modules", ...segments, "package.json");
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); }
    catch { problems.push(`vendored dependency ${path} is missing package.json`); continue; }
    if (pkg.version !== pin.version)
      problems.push(`vendored dependency ${path} is ${pkg.name}@${pkg.version}; expected ${pin.version}`);
    if (pkg.name !== expectedName)
      problems.push(`vendored dependency ${path} is named ${pkg.name}; expected ${expectedName}`);
  }
  return problems;
}

function writeRuntime() {
  writeRuntimeTree(RUNTIME_DIR, emitRuntime, "oma-web-access-emit-");
}

function writeManifest() {
  preserveNpmMetadata(BUNDLE_DIR);
  const records = bundleRecords(BUNDLE_DIR);
  const manifest = {
    kind: "oma-vendored-bundle-v1",
    package: packageMetadata(),
    generated: {
      runtime:
        "tsc emit of every upstream .ts module (index.ts is the extension " +
        "entry the OMA adapter drives — no exclusions), compiled with " +
        "upstream's own ESNext/bundler options from a staged copy whose " +
        "relative .ts specifiers were mechanically rewritten to .js, " +
        "then OMA divergence splices applied",
      tool: "scripts/vendor-pi-web-access.mjs",
      divergences: divergenceMetadata(OMA_DIVERGENCES),
      dependencies: DEPENDENCIES,
      packaging: NPM_METADATA_PACKAGING,
      upstreamTests:
        "upstream-tests/ is the repository's test/ tree at the vendored " +
        "commit (the npm tarball ships no tests); kept for provenance " +
        "and porting, not wired into npm test — upstream's suite needs " +
        "the upstream repo layout and hits the network for most provider " +
        "tests",
    },
    files: records,
    bundleSha256: bundleDigest(records),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const problems = bundleRecordProblems(manifest, BUNDLE_DIR);
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (manifest.package?.name !== pkg.name || manifest.package?.version !== pkg.version)
    problems.push("manifest package identity does not match upstream/package.json");
  if (!statSync(UPSTREAM_TESTS_DIR, { throwIfNoEntry: false })?.isDirectory())
    problems.push("upstream-tests/ is missing (the vendored commit's test/ tree belongs here)");
  problems.push(...dependencyProblems());
  // The manifest's own metadata is verified too: the divergence table must
  // equal this script's OMA_DIVERGENCES, package.* the pinned identity and
  // generated.dependencies the pinned closure, so a regenerated manifest
  // cannot launder a drifted splice or dependency set.
  problems.push(...manifestMetadataProblems(manifest));
  // The emitted runtime must be exactly what tsc produces from the vendored
  // sources plus the specifier rewrite and the declared OMA divergence
  // splices -- a hand-edited runtime/ file fails here even if someone
  // regenerated the manifest to match it, and so does a runtime missing a
  // declared splice.
  const scratch = mkdtempSync(join(tmpdir(), "oma-web-access-check-"));
  try {
    problems.push(...emittedRuntimeProblems(scratch, emitRuntime(scratch), RUNTIME_DIR));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(`vendored pi-web-access bundle is inconsistent:\n${problems.map(p => `  - ${p}`).join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const write = process.argv.slice(2).includes("--write");
    if (write) { writeRuntime(); const manifest = writeManifest(); console.log(JSON.stringify({ status: "BUNDLE_WRITTEN", files: manifest.files.length, bundleSha256: manifest.bundleSha256 })); }
    else { check(); console.log(JSON.stringify({ status: "BUNDLE_CURRENT", files: bundleRecords(BUNDLE_DIR).length })); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
