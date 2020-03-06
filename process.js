#!/usr/bin/env node

let { join } = require('path')

let processDir = require('./process-dir')
let cli = require('./cli')

cli(args => processDir(join(process.cwd(), args[0])))
