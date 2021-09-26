#!/usr/bin/env node

import { fileURLToPath } from 'url'
import { join } from 'path'

import { showVersion } from './show-version.js'
import { showHelp } from './show-help.js'
import { cli } from './cli.js'

let dirname = join(fileURLToPath(import.meta.url), '..')

cli(async (args, print) => {
  if (args.includes('--help')) {
    showHelp(print)
  } else if (args.includes('--version')) {
    showVersion(print)
  } else {
    let script = join(dirname, 'process.js')
    if (args.includes('--check')) {
      process.argv.push('--without-publish')
      script = join(dirname, 'process-and-rename.js')
    } else if (args.includes('--without-publish')) {
      script = join(dirname, 'process-and-rename.js')
    }
    process.argv.push('--before-script', script)
    await import('clean-publish/clean-publish.js')
  }
})
