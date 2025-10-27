root_path=$(pwd)

for d in internal_pkgs/*; do
  if [ -d "$d" ]; then
    cd "$d" || exit
    yarn
    cd "$root_path" || exit
  fi
done
