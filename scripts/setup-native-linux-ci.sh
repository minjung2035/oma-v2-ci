#!/usr/bin/env bash
# Shared disposable Linux CI prerequisite installer, never a product launcher.
# The actual native tests still prove containment, file and credential behavior.
set -euo pipefail
if [ "${CI-}" != true ] || [ "${GITHUB_ACTIONS-}" != true ] || [ "${RUNNER_OS-}" != Linux ]; then
  echo 'This installer requires an explicitly owned disposable Linux Actions runner.' >&2
  exit 2
fi
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'usage: setup-native-linux-ci.sh <evidence-directory>' >&2
  exit 2
fi
: "${GITHUB_PATH:?Actions PATH handoff is required}"
: "${RUNNER_TEMP:?Actions temporary directory is required}"
oma_native_tools=$(mktemp -d "$RUNNER_TEMP/oma-native-tools.XXXXXX")
oma_native_evidence=$1
mkdir -p "$oma_native_evidence"
node --input-type=module -e 'import {spawnSync} from "node:child_process"; console.log(JSON.stringify(Object.fromEntries(["rg","fd","fdfind","corepack"].map(command=>{const r=spawnSync(command,["--version"],{encoding:"utf8"});return [command,{status:r.status,error:r.error?.code,stdout:r.stdout,stderr:r.stderr}]}))))' > "$oma_native_evidence"/prerequisites-before.json
sudo apt-get update
sudo apt-get install -y bubblewrap meson ninja-build libcap-dev pkg-config ripgrep fd-find
# The pinned SDK's completion pass executes the real fd binary.
mkdir -p "$oma_native_tools/bin"
ln -s /usr/bin/fdfind "$oma_native_tools/bin/fd"
export PATH="$oma_native_tools/bin:$PATH"
echo "$oma_native_tools/bin" >> "$GITHUB_PATH"
# Node 25+ does not bundle Corepack; the declared Worker toolchain
# still requires it. https://github.com/nodejs/corepack/tree/v0.34.0
npm install --global --ignore-scripts corepack@0.34.0 > "$oma_native_evidence"/corepack-install.log 2>&1
corepack --version > "$oma_native_evidence"/corepack-version.txt
rg --version > "$oma_native_evidence"/ripgrep-version.txt
fd --version > "$oma_native_evidence"/fd-version.txt
sha256sum "$(command -v corepack)" /usr/bin/rg /usr/bin/fdfind > "$oma_native_evidence"/toolchain-sha256.txt
git init "$oma_native_tools/bubblewrap"
git -C "$oma_native_tools/bubblewrap" remote add origin https://github.com/containers/bubblewrap.git
git -C "$oma_native_tools/bubblewrap" fetch --depth=1 origin 2a76602a8c71f36c1527cf9fc3417d9149822e0c
git -C "$oma_native_tools/bubblewrap" checkout --detach FETCH_HEAD
test "$(git -C "$oma_native_tools/bubblewrap" rev-parse HEAD)" = 2a76602a8c71f36c1527cf9fc3417d9149822e0c
meson setup "$oma_native_tools/bubblewrap-build" "$oma_native_tools/bubblewrap" -Dtests=false -Dman=disabled -Dselinux=disabled -Dbash_completion=disabled -Dzsh_completion=disabled
meson compile -C "$oma_native_tools/bubblewrap-build" > "$oma_native_evidence"/bubblewrap-build.log 2>&1
sudo install -m 0755 "$oma_native_tools/bubblewrap-build/bwrap" /usr/bin/bwrap
/usr/bin/bwrap --version > "$oma_native_evidence"/bubblewrap-version.txt
sha256sum /usr/bin/bwrap > "$oma_native_evidence"/bubblewrap-sha256.txt
uname -a > "$oma_native_evidence"/kernel.txt
python3 - "$oma_native_evidence" <<'PY'
from pathlib import Path
import re, subprocess, json, sys
evidence = Path(sys.argv[1])
setting = Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
before = setting.read_bytes()
(evidence / 'userns-restriction-before.txt').write_bytes(before)
with (evidence / 'apparmor-profiles-before.txt').open('wb') as out:
    subprocess.run(['sudo', 'cat', '/sys/kernel/security/apparmor/profiles'], stdout=out, check=True)
attachment = re.compile(r'^\s*(?:profile\s+(?:"[^"]+"|\S+)\s+)?(?:"/usr/bin/bwrap"|/usr/bin/bwrap)(?=\s|\{)', re.M)
matching = [p for p in Path('/etc/apparmor.d').iterdir() if p.is_file() and attachment.search(p.read_text())]
if len(matching) > 1:
    raise RuntimeError('multiple AppArmor attachments for pinned bwrap: ' + repr(matching))
profile = evidence / 'bwrap.apparmor'
if matching:
    profile.write_bytes(matching[0].read_bytes())
    source = str(matching[0])
else:
    # Ubuntu's application-specific userns permission; no global
    # sysctl change and no replacement of OMA's namespace/seccomp tests.
    profile.write_text('abi <abi/4.0>,\ninclude <tunables/global>\nprofile oma-native-ci-bwrap /usr/bin/bwrap flags=(unconfined) {\n  userns,\n}\n')
    source = 'explicit CI profile for /usr/bin/bwrap'
subprocess.run(['sudo', 'apparmor_parser', '-r', str(profile)], check=True)
after = setting.read_bytes()
(evidence / 'userns-restriction-after.txt').write_bytes(after)
assert before == after, 'the global user namespace restriction must remain unchanged'
(evidence / 'apparmor-setup.json').write_text(json.dumps({'profileSource': source, 'globalRestrictionUnchanged': True}))
PY

# The complete verification lane includes the frozen LOC classification fixture.
curl -fsSL -o "$oma_native_evidence/cloc-2.08.pl" https://github.com/AlDanial/cloc/releases/download/v2.08/cloc-2.08.pl
echo "0a551a86c7785880bcaa0fdfe6107c064abfbebc7cc26b7eaeac423fe2c0d49e  $oma_native_evidence/cloc-2.08.pl" | sha256sum -c -
sudo install -m 0755 "$oma_native_evidence/cloc-2.08.pl" /usr/local/bin/cloc
test "$(cloc --version)" = 2.08
cloc --version > "$oma_native_evidence/cloc-version.txt"
