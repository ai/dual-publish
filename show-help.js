import { yellow as y, bold as b } from 'nanocolors'

export function showHelp(print) {
  print(
    b('Usage: ') + 'npx dual-publish',
    'Convert package to dual ESM/CommonJS package, clean development configs,',
    'and publish it to npm',
    '',
    b('Arguments:'),
    '  ' + y('--version') + '        Show version',
    '  ' + y('--help') + '           Show this message',
    '  ' + y('--check') + '          Left processed dir without publishing',
    '  ' + y('--access=public') + '  For public package in organizations',
    '  ' + y('--files') + '          One or more exclude files',
    '  ' + y('--fields') + '         One or more exclude package.json fields'
  )
}
