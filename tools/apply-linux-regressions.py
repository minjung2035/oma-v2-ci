#!/usr/bin/env python3
from pathlib import Path
import re


def exact(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {n}: {old[:100]!r}")
    p.write_text(s.replace(old, new, count))


# CFG-005: quota values are non-negative. Zero is valid for empty/disabled budgets.
exact(
    "src/config.ts",
    'const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 1);',
    'const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 0);',
)
exact(
    "src/config.ts",
    'needInt(quota["storageBytes"], "quota.storageBytes", 1);',
    'needInt(quota["storageBytes"], "quota.storageBytes", 0);',
)

# MessagePlan.id is the file id, while reply ancestry stores RFC Message-ID values.
exact(
    "src/validate.ts",
    'const messageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\\d+$/ });\nconst operationIdCheck = checkString({ re: /^op-[0-9a-f-]{36}$/ });',
    'const messageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\\d+$/ });\n'
    'const headerMessageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\\d+(?:@[a-z][a-z0-9-]{0,31}\\.oma\\.invalid)?$/ });\n'
    'const operationIdCheck = checkString({ re: /^op-[0-9a-f-]{36}$/ });',
)
exact(
    "src/validate.ts",
    '    inReplyTo: v => v === null ? null : messageIdCheck(v),\n    references: checkArray(messageIdCheck),',
    '    inReplyTo: v => v === null ? null : headerMessageIdCheck(v),\n    references: checkArray(headerMessageIdCheck),',
)

# The new terminal-state test fixture must satisfy operations.actor -> agents.name.
exact(
    "test/adversarial-contract-fixes.test.ts",
    '  try {\n    store.transaction(() => {\n      store.insertOperation({',
    '  try {\n    store.transaction(() => {\n'
    '      store.insertAgent({\n'
    '        name: "alice",\n'
    '        specHash: "alice",\n'
    '        role: "resident",\n'
    '        desired: "enabled",\n'
    '        incarnation: 0,\n'
    '        profile: "resident",\n'
    '        createdBy: null,\n'
    '        specJson: "{}",\n'
    '      });\n'
    '      store.insertOperation({',
)

# Serialization must exercise a valid streamed request. Invalid mediaType is tested separately.
p = Path("test/audit2.test.ts")
s = p.read_text()
s, n = re.subn(
    r'(id: "c1",[\s\S]{0,1400}?mediaType: )"x"',
    r'\1"application/x-git-bundle"',
    s,
    count=1,
)
if n != 1:
    raise SystemExit(f"test/audit2.test.ts: serialize mediaType replacement count={n}")
p.write_text(s)

# RFC header field names are case-insensitive; do not force body-wide casing rewrites.
exact(
    "test/phase3.test.ts",
    '  assert.ok(emlDirect.text.includes("X-OMA-Kind: message"));',
    '  assert.match(emlDirect.text.split(/\\r?\\n\\r?\\n/, 1)[0]!, /^X-OMA-Kind: message$/im);',
)

# The trusted BatchView fixture itself must use a valid OMA message id.
exact(
    "test/phase5.test.ts",
    '      messageIds: ["m-x-0"],',
    '      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"],',
)

# MessagePlan persists logical addresses; RFC encoding happens only at the EML boundary.
exact(
    "test/phase7.test.ts",
    '    assert.deepEqual(frozenMessage.message.to, ["commons@demo.oma.invalid"]);',
    '    assert.deepEqual(frozenMessage.message.to, ["commons"]);',
)

# This is a one-shot migration helper; do not leave it in the product diff.
Path(__file__).unlink()
print("applied Linux regression fixes; now run npm run typecheck && npm test")
