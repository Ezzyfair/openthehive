#!/bin/bash
cd "$(dirname "$0")/.."
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}'
exec npx ts-node scripts/scout-engagement-worker.ts
