#!/bin/bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo 'Usage: bash install-hq.command <authenticated archive.zip> <independently verified archive SHA-256> [absent target.app]' >&2
  echo 'Read INSTALL.txt and verify the release provenance before executing this launcher.' >&2
  exit 2
fi

archive=$1
expected=$2
target=${3:-"$HOME/Applications/HQ.app"}
[[ "$archive" = /* && "$target" = /* && "$target" = *.app ]] || { echo 'Absolute archive and target paths are required.' >&2; exit 2; }
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo 'An independently verified SHA-256 is required.' >&2; exit 2; }
[[ ! -e "$target" && ! -L "$target" ]] || { echo 'Existing target refused. Adoption requires exact operator metadata; see INSTALL.txt.' >&2; exit 1; }
actual=$(/usr/bin/shasum -a 256 "$archive")
[[ "${actual%% *}" = "$expected" ]] || { echo 'Archive digest differs from the independently verified value.' >&2; exit 1; }
scratch_parent="$HOME/Library/Caches/HQ-Installer"
/bin/mkdir -p "$scratch_parent"
scratch_root=$(/usr/bin/mktemp -d "$scratch_parent/install.XXXXXXXX")
cleanup() { local result=$?; trap - EXIT; /bin/rm -rf -- "$scratch_root" || { [[ $result -ne 0 ]] || result=1; }; exit "$result"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/ditto -x -k --norsrc "$archive" "$scratch_root"
bundle="$scratch_root/HQ.app"
[[ -d "$bundle" && ! -L "$bundle" ]] || { echo 'Authenticated archive lacks HQ.app.' >&2; exit 1; }
/usr/bin/codesign --verify --deep --strict "$bundle"
[[ -f "$bundle/Contents/Resources/app/tools/updater/installer.cjs" ]] || { echo 'Installer is missing.' >&2; exit 1; }

# Run only the fresh extraction of the independently authenticated archive.
/usr/bin/env ELECTRON_RUN_AS_NODE=1 "$bundle/Contents/MacOS/HQ" "$bundle/Contents/Resources/app/tools/updater/installer.cjs" fresh --channel preview --target "$target"
