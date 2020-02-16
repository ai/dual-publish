#!/usr/bin/env node

let { join } = require('path')
let chalk = require('chalk')

let showVersion = require('./show-version')
let processDir = require('./process-dir')
let showHelp = require('./show-help')

function error (message) {
  process.stderr.write(chalk.red(message) + '\n')
}

function print (...lines) {
  process.stdout.write(lines.join('\n') + '\n')
}

let args = process.argv.slice(2)

async function run () {
  if (args.some(i => i === '--help')) {
    showHelp(print)
  } else if (args.some(i => i === '--version')) {
    showVersion(print)
  } else if (args.length === 1 && !args[0].startsWith('--')) {
    await processDir(join(process.cwd(), args[0]))
  } else {
    process.argv.push('--before-script', process.argv[1])
    require('clean-publish/clean-publish')
  }
}

run().catch(e => {
  error(chalk.red(e.stack))
  process.exit(1)
})
