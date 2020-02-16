let { remove, copy, readFile, writeFile } = require('fs-extra')
let { promisify } = require('util')
let { tmpdir } = require('os')
let { join } = require('path')
let nanoid = require('nanoid/non-secure')
let globby = require('globby')
let child = require('child_process')

let processDir = require('../process-dir')

let exec = promisify(child.exec)

let dirs = []

afterEach(() => Promise.all(dirs.map(i => remove(i))))

async function copyDirs () {
  let lib = join(tmpdir(), 'dual-publish-lib-' + nanoid())
  dirs.push(lib)
  let runner = join(tmpdir(), 'dual-publish-runner-' + nanoid())
  dirs.push(runner)
  await copy(join(__dirname, 'fixtures', 'lib'), lib)
  await copy(join(__dirname, 'fixtures', 'runner'), runner)
  return [lib, runner]
}

async function replaceConsole (dir) {
  let files = await globby('**/*.mjs', { cwd: dir, absolute: true })
  await Promise.all(files.map(async i => {
    let source = await readFile(i)
    let fixed = source.toString().replace(/'cjs /, '\'esm ')
    await writeFile(i, fixed)
  }))
}

function removeEsmWarning (stderr) {
  return stderr
    .split('\n')
    .filter(i => !i.includes(
      'ExperimentalWarning: The ESM module loader is experimental'
    ))
    .join('\n')
}

it('compiles for Node.js', async () => {
  let [lib, runner] = await copyDirs()
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  expect(cjs.stderr).toEqual('')
  expect(cjs.stdout).toEqual('cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\n')

  let esm = await exec('node ' + join(runner, 'index.mjs'))
  expect(removeEsmWarning(esm.stderr)).toEqual('')
  expect(esm.stdout).toEqual('esm d\nesm a\nesm b\nesm c\nesm lib\n')
})

it('throws on non-index file', async () => {
  let err
  try {
    await processDir(join(__dirname, 'fixtures', 'non-index-error'))
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual('Rename file.js to file/index.js')
})

it('throws on index require without .js', async () => {
  let err
  try {
    await processDir(join(__dirname, 'fixtures', 'non-js-index-error'))
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual(
    'Replace `index` in require() to `index.js` at index.js'
  )
})
