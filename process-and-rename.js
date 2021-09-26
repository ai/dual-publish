#!/usr/bin/env node

import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { bold } from 'nanocolors'

import { processDir } from './process-dir.js'
import { cli } from './cli.js'

cli(async (args, print) => {
  let tmpdir = join(process.cwd(), args[0])
  await processDir(tmpdir)
  await fs.rename(tmpdir, join(dirname(tmpdir), 'dual-publish-tmp'))
  print('Check npm package content in ' + bold('./dual-publish-tmp/'))
})
