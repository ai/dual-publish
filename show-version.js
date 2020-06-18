let { bold } = require('kleur')

let pkg = require('./package.json')

module.exports = function showVersion (print) {
  print(`dual-publish ${bold(pkg.version)}`)
}
