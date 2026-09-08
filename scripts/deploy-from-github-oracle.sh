#!/usr/bin/env bash
set -euo pipefail

repository="${COURTLY_GITHUB_REPOSITORY:-aritejhg/courtly}"
source_dir="${COURTLY_GITHUB_SOURCE_DIR:-/opt/courtly/source}"
app_dir="${COURTLY_APP_DIR:-/opt/courtly/app}"
deploy_key="${COURTLY_GITHUB_KEY:-/opt/courtly/.ssh/github_deploy_key}"
known_hosts="${COURTLY_GITHUB_KNOWN_HOSTS:-/opt/courtly/.ssh/github_known_hosts}"
lock_path="$app_dir/work/github-deploy.lock"
deployed_marker="$app_dir/.courtly-source-commit"

mkdir -p "$app_dir/work"
exec 9>"$lock_path"
flock -n 9 || exit 0

export GIT_SSH_COMMAND="ssh -i $deploy_key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"
remote_url="git@github.com:${repository}.git"

if [[ ! -d "$source_dir/.git" ]]; then
  mkdir -p "$(dirname "$source_dir")"
  git clone --branch main --single-branch "$remote_url" "$source_dir"
else
  git -C "$source_dir" remote set-url origin "$remote_url"
  git -C "$source_dir" fetch --prune origin main
fi

target_commit="$(git -C "$source_dir" rev-parse origin/main)"
current_commit="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true)"
deployed_commit="$(cat "$deployed_marker" 2>/dev/null || true)"
if [[ "$current_commit" == "$target_commit" && "$deployed_commit" == "$target_commit" ]]; then
  exit 0
fi

old_lock_hash=""
if [[ -f "$app_dir/package-lock.json" ]]; then
  old_lock_hash="$(sha256sum "$app_dir/package-lock.json" | awk '{print $1}')"
fi

git -C "$source_dir" reset --hard "$target_commit"
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='work/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.courtly-source-commit' \
  --exclude='data/ambiguity-review-history.json' \
  --exclude='data/parser-ambiguities.json' \
  --exclude='data/telegram-listings.json' \
  --exclude='data/telegram-messages.json' \
  --exclude='data/unmatched-venue-candidates.json' \
  "$source_dir/" "$app_dir/"

new_lock_hash=""
if [[ -f "$app_dir/package-lock.json" ]]; then
  new_lock_hash="$(sha256sum "$app_dir/package-lock.json" | awk '{print $1}')"
fi
if [[ "$old_lock_hash" != "$new_lock_hash" ]]; then
  npm --prefix "$app_dir" ci --no-audit --no-fund
fi

printf '%s\n' "$target_commit" > "$deployed_marker"
printf 'Courtly Oracle source updated to %s\n' "$target_commit"
