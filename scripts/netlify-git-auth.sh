#!/bin/bash
# Runs as npm `preinstall` hook. On Netlify (NETLIFY=true) it sets a global
# git URL rewrite that embeds the GITHUB_PAT (or GITHUB_TOKEN fallback) into
# any https/ssh github.com URL, so npm's git subprocess can clone the
# private `@sipgate/revop-ui` dep via authenticated HTTPS.
#
# Locally this is a no-op — devs have their own SSH keys / git creds and
# don't need this rewrite.
set -e

# Only act on Netlify build agents.
if [ "${NETLIFY:-false}" != "true" ]; then
  exit 0
fi

TOKEN="${GITHUB_PAT:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "[netlify-git-auth] WARNING: NETLIFY=true but no GITHUB_PAT / GITHUB_TOKEN set."
  echo "[netlify-git-auth] Private git deps will fail to clone. Set GITHUB_PAT in the Netlify dashboard."
  exit 0
fi

# Rewrite all three forms (ssh://, scp-style, plain https) to token-embedded
# https. The x-access-token:<pat> form is GitHub's documented basic-auth path
# for PATs and Fine-Grained tokens.
#
# Netlify's own build image may already set url.*.insteadOf entries in the
# global git config. A plain `git config --global` refuses to overwrite when
# multiple values exist ("cannot overwrite multiple values with a single
# value"). Wipe any pre-existing entries for our key first, then set ours.
TARGET="https://x-access-token:${TOKEN}@github.com/"
git config --global --unset-all "url.${TARGET}.insteadOf" 2>/dev/null || true
git config --global "url.${TARGET}.insteadOf" "ssh://git@github.com/"
git config --global --add "url.${TARGET}.insteadOf" "git@github.com:"
git config --global --add "url.${TARGET}.insteadOf" "https://github.com/"

echo "[netlify-git-auth] github.com URLs rewritten to token-auth HTTPS."
