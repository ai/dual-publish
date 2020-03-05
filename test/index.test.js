let { remove, copy, readFile, writeFile } = require('fs-extra')
let { join, dirname } = require('path')
let { promisify } = require('util')
let { tmpdir } = require('os')
let webpack = require('webpack')
let nanoid = require('nanoid/non-secure')
let globby = require('globby')
let child = require('child_process')

let processDir = require('../process-dir')

let exec = promisify(child.exec)

let toClean = []

afterEach(() => Promise.all(toClean.map(i => remove(i))))

let esmNode = 'node '
if (process.version.startsWith('v12.')) {
  esmNode = 'node --experimental-modules '
}

function copyDirs (...dirs) {
  return Promise.all(dirs.map(async dir => {
    let tmp = join(tmpdir(), `dual-publish-${ dir }-${ nanoid() }`)
    await copy(join(__dirname, 'fixtures', dir), tmp)
    toClean.push(tmp)
    return tmp
  }))
}

async function replaceConsole (dir) {
  let files = await globby('**/*.js', { cwd: dir, absolute: true })
  await Promise.all(files.map(async i => {
    let source = await readFile(i)
    let fixed = source.toString().replace(/'cjs /, '\'esm ')
    await writeFile(i, fixed)
  }))
}

async function buildWithWebpack (path) {
  await new Promise((resolve, reject) => {
    webpack({
      entry: join(path),
      output: {
        path: dirname(path)
      }
    }, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
  return join(dirname(path), 'main.js')
}

it('compiles for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  expect(cjs.stderr).toEqual('')
  expect(cjs.stdout).toEqual('cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\n')

  if (process.version.startsWith('v10.')) return
  let esm = await exec(esmNode + join(runner, 'index.mjs'))
  if (process.version.startsWith('v12.')) {
    expect(esm.stderr).toEqual(
      '(node:8846) ExperimentalWarning: ' +
      'The ESM module loader is experimental.\n'
    )
  } else {
    expect(esm.stderr).toEqual(
      '(node:8846) ExperimentalWarning: ' +
      'The ESM module loader is experimental.\n'
    )
  }
  expect(esm.stdout).toEqual('esm d\nesm a\nesm b\nesm c\nesm lib\n')
})

it('reads npmignore', async () => {
  let [lib] = await copyDirs('lib')
  await processDir(lib)
  let files = await globby('**/*.cjs', { cwd: lib })
  expect(files).not.toContain('e/index.cjs')
})

it('works with modules in webpack', async () => {
  let [lib, client] = await copyDirs('lib', 'client')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'))

  let { stdout, stderr } = await exec('node ' + bundle)
  expect(stderr).toEqual('')
  expect(stdout).toEqual('esm d\nesm a\nesm b\nesm browser c\nesm lib\n')

  let buffer = await readFile(bundle)
  expect(buffer.toString()).not.toContain('shaked-export')
})

it('works with require in webpack', async () => {
  let [lib, client] = await copyDirs('lib', 'client')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'cjs.js'))

  let { stdout, stderr } = await exec('node ' + bundle)
  expect(stderr).toEqual('')
  expect(stdout).toEqual('esm d\nesm a\nesm b\nesm browser c\nesm lib\n')
})

it('throws on non-index file', async () => {
  let [lib] = await copyDirs('non-index-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual('Rename file.js to file/index.js')
})

it('throws on index require without .js', async () => {
  let [lib] = await copyDirs('non-js-index-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual(
    'Replace `index` in require() to `index.js` at index.js'
  )
})

it('throws on un-processed require', async () => {
  let [lib] = await copyDirs('other-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual(
    'Unsupported require() at index.js:1:18'
  )
})
