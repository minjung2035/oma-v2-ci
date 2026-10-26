// Authored source corpus; none of these entries claims to be a measured fuzz discovery.
export const FUZZ_SEEDS = [0x36f00d, 1, 0, 0xffffffff] as const;
export const INVALID_JSON = [
  '{"v":1,"v":1}', '{"v":1,"\\u0076":1}', '{"nested":{"a":1,"a":2}}',
  '{"n":9007199254740992}', '{"n":1e999}', '{"s":"\\ud800"}', '[1,2]', 'null', '{"x":',
] as const;
export const VALID_JSON = [
  { v: 1, id: "empty", params: {} },
  { v: 1, id: "한글🙂", params: { text: 'quote"slash\\', n: 42, nested: [true, null] } },
] as const;
export const GIT_VALID = "A\0new file.txt\0M\0한글.txt\0";
export const GIT_INVALID = ["A\0missing-end", "R100\0old\0new\0", "M\0../escape\0", "A\0x\0D\0", "M\0\0"] as const;
export const EML_VALID = "Subject: fixture\r\nX-OMA-Kind: message\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nbody";
export const EML_INVALID = ["Subject: first\r\nsubject: second\r\n", " orphan\r\n", "Content-Type: multipart/mixed\r\n", "X-OMA-Kind: approved\r\n", "Subject: bad\u0000value\r\n"] as const;
export const SETUP_VALID = '{"kind":"prepared"}\n{"kind":"ready"}\n';
export const SETUP_FAILED = '{"kind":"failed","code":"REF_STATE_UNKNOWN"}\n';
export const SETUP_INVALID = ["", '{"kind":"ready"}\n', '{"kind":"prepared"}\n',
  '\ufeff{"kind":"prepared"}\n{"kind":"ready"}\n',
  '{"kind":"prepared","extra":true}\n', '{"kind":"prepared"}\n{"kind":"prepared"}\n',
  '{"kind":"failed","code":"CHECK_FAILED"}\n', '{"kind":"failed","code":"REF_STATE_UNKNOWN"}\n{"kind":"ready"}\n',
  "x".repeat(1025)] as const;
