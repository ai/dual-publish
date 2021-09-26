#!/usr/bin/env node

import { dirname, join } from 'path'
import { rename } from 'fs/promises'
import { bold } from 'nanocolors'

import { processDir } from './process-dir.js'
import { cli } from './cli.js'

cli(async (args, print) => {
  let tmpdir = join(process.cwd(), args[0])
  await processDir(tmpdir)
  await rename(tmpdir, join(dirname(tmpdir), 'dual-publish-tmp'))
  print('Check npm package content in ' + bold('./dual-publish-tmp/'))
})
