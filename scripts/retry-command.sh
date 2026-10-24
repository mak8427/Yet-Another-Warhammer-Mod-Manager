#!/usr/bin/env bash
set -euo pipefail

attempts=${CI_RETRY_ATTEMPTS:-3}
delay=${CI_RETRY_DELAY_SECONDS:-5}
if [[ $# -eq 0 || ! "$attempts" =~ ^[1-5]$ || ! "$delay" =~ ^([0-9]|[12][0-9]|30)$ ]]; then
  echo "retry-command: provide a command, 1-5 attempts, and a delay of 0-30 seconds" >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if "$@"; then
    exit 0
  else
    status=$?
  fi
  if ((attempt == attempts || status >= 126)); then
    exit "$status"
  fi
  wait_seconds=$((delay * attempt))
  echo "retry-command: attempt $attempt/$attempts failed with exit $status; retrying in ${wait_seconds}s" >&2
  sleep "$wait_seconds"
done
