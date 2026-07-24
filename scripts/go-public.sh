#!/usr/bin/env bash
#
# Prepare this repo to be flipped public (PLAN.md §"Ship").
#
# The repo currently holds strategy that should not ship: kill gates, pricing
# hypotheses, competitor reasoning, and an audit report naming every defect the
# catalog has had. None of it is secret exactly, but all of it is yours, and a
# competitor reading CHECKLIST.md learns more about the plan than the product.
#
# This moves those files to a sibling private repo and leaves the public one with
# code, data, README and site. It does NOT flip repo visibility — that is a
# deliberate, irreversible-feeling click you should make yourself on GitHub.
#
#   bash scripts/go-public.sh --check     # report only, change nothing (default)
#   bash scripts/go-public.sh --move      # actually move the files
#
set -euo pipefail

MODE="${1:---check}"
PRIVATE_DIR="${MARINATE_PRIVATE_DIR:-../marinate-private}"

STRATEGY_FILES=(PLAN.md CHECKLIST.md RESUME.md)
STRATEGY_DIRS=(docs)

echo "== files that would leave the public repo =="
for f in "${STRATEGY_FILES[@]}"; do [ -e "$f" ] && echo "  $f"; done
for d in "${STRATEGY_DIRS[@]}"; do [ -e "$d" ] && echo "  $d/ ($(find "$d" -type f | wc -l | tr -d ' ') files)"; done

echo
echo "== LINKS to those files from files that STAY public =="
# Only actual links matter — a clickable ./PLAN.md in the README 404s for every visitor
# and advertises that a private planning doc exists.
#
# Prose citations in source comments ("PLAN.md §13") are deliberately NOT flagged. They
# will dangle, but they're section references, not links, and they show the code was
# written against a spec rather than improvised. Leave them.
PATTERN="$(IFS='|'; echo "${STRATEGY_FILES[*]}")"
LINKS=$(grep -rInE "\]\((\./)?($PATTERN)\)|href=[\"'](\./)?($PATTERN)[\"']" \
  README.md site/ .github/ 2>/dev/null | grep -v node_modules || true)
if [ -n "$LINKS" ]; then
  echo "$LINKS"
  echo
  echo "  ^ these become 404s the moment the repo is public. Fix before flipping."
else
  echo "  none"
fi

echo
echo "== sanity scan of what remains public =="
# Not a secret scanner — just the specific things this repo is likely to leak.
LEAKS=0
if grep -rIn "/Users/" README.md site/ packages/*/src packages/action .github/ scripts/ 2>/dev/null | grep -v node_modules | head -5; then
  echo "  ^ absolute local paths"; LEAKS=1
fi
if grep -rInE "(sk-[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-)" . --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -5; then
  echo "  ^ possible credential"; LEAKS=1
fi
[ "$LEAKS" -eq 0 ] && echo "  clean"

if [ "$MODE" != "--move" ]; then
  echo
  echo "check only — nothing moved. Re-run with --move when you're ready."
  exit 0
fi

echo
mkdir -p "$PRIVATE_DIR"
for f in "${STRATEGY_FILES[@]}"; do
  [ -e "$f" ] && git mv "$f" "$PRIVATE_DIR/" 2>/dev/null || { [ -e "$f" ] && mv "$f" "$PRIVATE_DIR/"; }
  echo "  moved $f"
done
for d in "${STRATEGY_DIRS[@]}"; do
  [ -e "$d" ] && mv "$d" "$PRIVATE_DIR/" && echo "  moved $d/"
done

cat <<EOF

moved to: $PRIVATE_DIR

Remaining steps, all yours:
  1. cd $PRIVATE_DIR && git init && git add -A && git commit
     (push it somewhere private — this is the only copy now)
  2. back here: git add -A && git commit -m "Relocate strategy docs ahead of going public"
  3. re-run: bash scripts/go-public.sh --check    # confirm no dangling references
  4. GitHub → Settings → General → Danger Zone → Change visibility

Note git history still contains these files. If that matters, the repo needs a
fresh history rather than a rewrite — squashing a public repo's history after the
fact is not something to do under launch-day pressure.
EOF
