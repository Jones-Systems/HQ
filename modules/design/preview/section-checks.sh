#!/usr/bin/env bash
# Serial section checks for the assembled Design integration candidate.
# Runs every cone's own typecheck, node:test and vitest commands, one process at
# a time, from the HQ root. Root `npm test` covers the foundation only, so these
# are the lane-inclusive checks. Take a capacity sample and hold the shared
# check lock before running (see README.md). Exits non-zero if any check fails
# or a cone is missing.
set -u
cd "$(dirname "$0")/../../.."
ROOT=$PWD
TSC="$ROOT/node_modules/.bin/tsc"
VITEST="$ROOT/node_modules/.bin/vitest"

CONES=(annotations canvas compare components connector discovery flows imports projects references requests taste ui)
STORE=packages/design-store
# Production composition entry (COMPOSE) and its renderer-safe storage seam (STORE).
APP=modules/design/app
# Node-only reference producer, nested in the references cone with its own tsconfig.
PRODUCER=modules/design/references/producer
VITEST_CONES=(annotations canvas compare components references requests taste ui)

failures=0
run() {
  local label=$1; shift
  printf '\n### %s\n$ %s\n' "$label" "$*"
  "$@"
  local status=$?
  printf -- '--> %s exit=%d\n' "$label" "$status"
  [ "$status" -eq 0 ] || failures=$((failures + 1))
}

for cone in "${CONES[@]}"; do
  [ -f "modules/design/$cone/tsconfig.json" ] || { echo "MISSING cone modules/design/$cone"; failures=$((failures + 1)); }
done
[ -f "$STORE/tsconfig.json" ] || { echo "MISSING cone $STORE"; failures=$((failures + 1)); }
for config in "$APP/tsconfig.json" "$APP/storage/tsconfig.json" "$PRODUCER/tsconfig.json"; do
  [ -f "$config" ] || { echo "MISSING $config"; failures=$((failures + 1)); }
done

for cone in "${CONES[@]}"; do
  run "$cone typecheck" "$TSC" -p "modules/design/$cone/tsconfig.json"
done
run "design-store typecheck" "$TSC" -p "$STORE/tsconfig.json"
run "app typecheck" "$TSC" -p "$APP/tsconfig.json"
run "app storage typecheck" "$TSC" -p "$APP/storage/tsconfig.json"
run "references producer typecheck" "$TSC" -p "$PRODUCER/tsconfig.json"
run "preview typecheck" "$TSC" -p modules/design/preview/tsconfig.json

# node:test files per cone. *.tsx renders and compare's suites run under vitest.
node_tests() {
  case $1 in
    ui) echo modules/design/ui/test/node/*.test.ts ;;
    components) echo modules/design/components/tests/*.test.ts ;;
    *) echo modules/design/"$1"/test/*.test.ts ;;
  esac
}
for cone in "${CONES[@]}"; do
  case $cone in
    compare) ;;
    flows) run "flows node:test" bash -c 'cd modules/design/flows && node --test --test-concurrency=1 test/*.test.ts' ;;
    # shellcheck disable=SC2046
    *) run "$cone node:test" node --test --test-concurrency=1 $(node_tests "$cone") ;;
  esac
done
run "design-store node:test" bash -c "cd $STORE && node --test --test-concurrency=1 test/*.test.ts"
# shellcheck disable=SC2086
run "app compose node:test" node --test --test-concurrency=1 $APP/compose/test/*.test.ts
# shellcheck disable=SC2086
run "app storage node:test" node --test --test-concurrency=1 $APP/storage/test/*.test.ts
# shellcheck disable=SC2086
run "references producer node:test" node --test --test-concurrency=1 $PRODUCER/test/*.test.ts
run "preview node:test" node --test --test-concurrency=1 modules/design/preview/test/*.test.ts

for cone in "${VITEST_CONES[@]}"; do
  run "$cone vitest" "$VITEST" run --config "modules/design/$cone/vitest.config.ts"
done

printf '\nSECTION CHECKS: %d failing command(s)\n' "$failures"
[ "$failures" -eq 0 ]
