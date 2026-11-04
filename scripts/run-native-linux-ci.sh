#!/usr/bin/env bash
# Enter a delegated scope on an owned disposable CI runner. Product launchers
# do not invoke a user manager; the tests exercise their native launchers.
set -euo pipefail
if [ "${CI-}" != true ] || [ "${GITHUB_ACTIONS-}" != true ] || [ "${RUNNER_OS-}" != Linux ]; then
  echo 'This test wrapper requires an explicitly owned disposable Linux Actions runner.' >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  echo 'usage: run-native-linux-ci.sh <command> [arguments...]' >&2
  exit 2
fi
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
test -S "$XDG_RUNTIME_DIR/bus"
# --scope executes synchronously with the caller environment, working
# directory, stdio and exit status. Each invocation owns a distinct scope.
exec systemd-run --user --scope --collect --quiet --property=Delegate=yes -- "$@"
