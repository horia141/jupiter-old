#!/bin/bash

set -e

rm -f .env
if [ -z ${ENV+x} ]
then
    cat src/server/config/env.local > .env
    cat src/server/config/env.local.secrets >> .env
else
    cat src/server/config/env.$(echo ${ENV} | awk '{print tolower($0)}') > .env
    cat src/server/config/env.$(echo ${ENV} | awk '{print tolower($0)}').secrets >> .env
fi
set -a
source .env
set +a
