#!/usr/bin/env node

let { join } = require('path')

let showVersion = require('./show-version')
let showHelp = require('./show-help')
let cli = require('./cli')

cli(async (args, print) => {
  if (args.includes('--help')) {
    showHelp(print)
  } else if (args.includes('--version')) {
    showVersion(print)
  } else {
    let script = join(__dirname, 'process.js')
    if (args.includes('--check')) {
      process.argv.push('--without-publish')
      script = join(__dirname, 'process-and-rename.js')
    } else if (args.includes('--without-publish')) {
      script = join(__dirname, 'process-and-rename.js')
    }
    process.argv.push('--before-script', script)
    require('clean-publish/clean-publish')
  }
})
