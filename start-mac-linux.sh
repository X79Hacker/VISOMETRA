#!/bin/sh
# Starts the Sector Map app and opens it in your browser.
cd "$(dirname "$0")"
if [ -x .venv-sam3/bin/python ]; then
  exec .venv-sam3/bin/python server.py "$@"
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python server.py "$@"
else
  echo "Python 3 is not installed. Get it from https://www.python.org/downloads/"
  exit 1
fi
