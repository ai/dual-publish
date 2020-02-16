let chalk = require('chalk')

let pkg = require('./package.json')

module.exports = function showVersion (print) {
  print(`dual-publish ${ chalk.bold(pkg.version) }`)
}
