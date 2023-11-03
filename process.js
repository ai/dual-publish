#!/usr/bin/env node

import { join } from 'node:path'

import { cli } from './cli.js'
import { processDir } from './process-dir.js'

cli(args => processDir(join(process.cwd(), args[0])))
