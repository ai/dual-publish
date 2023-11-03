#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import pico from 'picocolors'

import { cli } from './cli.js'
import { processDir } from './process-dir.js'

cli(async (args, print) => {
  let tmpdir = join(process.cwd(), args[0])
  await processDir(tmpdir)
  await fs.rename(tmpdir, join(dirname(tmpdir), 'dual-publish-tmp'))
  print('Check npm package content in ' + pico.bold('./dual-publish-tmp/'))
})
