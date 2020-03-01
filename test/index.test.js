let { remove, copy, readFile, writeFile } = require('fs-extra')
let { promisify } = require('util')
let { tmpdir } = require('os')
let { join } = require('path')
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

function removeEsmWarning (stderr) {
  return stderr
    .split('\n')
    .filter(i => !i.includes(
      'ExperimentalWarning: The ESM module loader is experimental'
    ))
    .join('\n')
}

it('compiles for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  expect(cjs.stderr).toEqual('')
  expect(cjs.stdout).toEqual('cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'))
    expect(removeEsmWarning(esm.stderr)).toEqual('')
    expect(esm.stdout).toEqual('esm d\nesm a\nesm b\nesm c\nesm lib\n')
  }
})

it('reads npmignore', async () => {
  let [lib] = await copyDirs('lib')
  await processDir(lib)
  let files = await globby('**/*.cjs', { cwd: lib })
  expect(files).not.toContain('e/index.cjs')
})

it('works with webpack', async () => {
  let [lib, client] = await copyDirs('lib', 'client')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: client })

  await new Promise((resolve, reject) => {
    webpack({
      entry: join(client, 'index.js'),
      output: {
        path: client
      }
    }, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })

  let buffer = await readFile(join(client, 'main.js'))
  let bundle = buffer.toString()
  expect(bundle).not.toContain('cjs ')
  expect(bundle).toContain('esm ')
  expect(bundle).toContain('esm browser c')
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

it('throws on un-processed require', async () => {
  let err
  try {
    await processDir(join(__dirname, 'fixtures', 'other-error'))
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual(
    'Unsupported require() at index.js:1:15'
  )
})
