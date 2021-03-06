#!/bin/bash

set -e

# ts-node config
export TS_NODE_PROJECT=src/client/tsconfig.json
export TS_NODE_FILES=true

npx ts-node-dev --inspect=${INSPECT_PORT} -- src/client/index.ts