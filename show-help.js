let chalk = require('chalk')

let y = chalk.yellow
let b = chalk.bold

module.exports = function showHelp (print) {
  print(
    b('Usage: ') + 'npx dual-publish',
    'Convert package to dual ESM/CommonJS package, clean development configs,',
    'and publish it to npm',
    '',
    b('Arguments:'),
    '  ' + y('--version') + '          Show version',
    '  ' + y('--help') + '             Show this message',
    '  ' + y('--without-publish') + '  Left processed dir without publishing',
    '  ' + y('--access=public') + '    For public package in organizations',
    '  ' + y('--files') + '            One or more exclude files',
    '  ' + y('--fields') + '           One or more exclude package.json fields'
  )
}
