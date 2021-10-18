case $(sed --help 2>&1) in
  *GNU*) sed_i () { xargs sed -i "$@"; };;
  *) sed_i () { xargs sed -i '' "$@"; };;
esac

grep -l --exclude-dir={.git,node_modules,artifacts,contracts} -r "component main = Transaction([0-9]*," . | sed_i "s/component main = Transaction([0-9]*,/component main = Transaction(${1},/g"
