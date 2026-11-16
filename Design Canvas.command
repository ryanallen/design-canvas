#!/bin/sh
# Double-click in Finder: pick a folder of prototypes, then what to do with it.
cd "$(dirname "$0")" && node scripts/app.mjs
