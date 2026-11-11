#!/bin/sh
# Compila Navio: genera index.html y assets/ a partir de src/.
# Corre esto después de cada cambio en src/. La primera vez (o si cambia
# tools/package.json) hay que instalar las herramientas:
#   cd tools && npm install --ignore-scripts
set -e
cd "$(dirname "$0")"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x "/d/Nueva/Node/node.exe" ] && NODE="/d/Nueva/Node/node.exe"
if [ -z "$NODE" ]; then
  echo "No encontré Node.js. Instálalo o agrégalo al PATH." >&2
  exit 1
fi
exec "$NODE" tools/build.mjs "$@"
