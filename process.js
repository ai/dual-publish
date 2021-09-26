#!/usr/bin/env node

import { join } from 'path'

import { processDir } from './process-dir.js'
import { cli } from './cli.js'

cli(args => processDir(join(process.cwd(), args[0])))
