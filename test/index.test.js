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

function trimCode (stderr) {
  return stderr.replace(/\(node:\d+\) /g, '')
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
    if (process.version.startsWith('v12.')) {
      expect(trimCode(esm.stderr)).toEqual(
        'ExperimentalWarning: The ESM module loader is experimental.\n' +
        'ExperimentalWarning: Conditional exports is an experimental feature.' +
        ' This feature could change at any time\n'
      )
    } else {
      expect(trimCode(esm.stderr)).toEqual(
        'ExperimentalWarning: The ESM module loader is experimental.\n'
      )
    }
    expect(esm.stdout).toEqual('esm d\nesm a\nesm b\nesm c\nesm lib\n')
  }
})

it('compiles default export for Node.js', async () => {
  let [lib, runner] = await copyDirs('default-lib', 'default-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  expect(cjs.stdout).toEqual('cjs a\ncjs lib\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'))
    expect(esm.stdout).toEqual('esm a\nesm lib\n')
  }
})

it('compiles for TypeScript', async () => {
  let [lib, runner] = await copyDirs('lib', 'ts-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })
  await exec('npx tsc --build ' + join(runner, 'tsconfig.json'))
})

it('allows to use sub-files for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'subfile.cjs'))
  expect(cjs.stdout).toEqual('cjs a\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'subfile.mjs'))
    expect(esm.stdout).toEqual('esm a\n')
  }
})

it('reads npmignore', async () => {
  let [lib] = await copyDirs('lib')
  await processDir(lib)
  let files = await globby('**/*.cjs', { cwd: lib })
  expect(files).not.toContain('e/index.cjs')
})

it('works with modules in webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: client })
  await exec(`yarn add client-lib@${ clientLib }`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'))

  let { stdout, stderr } = await exec('node ' + bundle)
  expect(stderr).toEqual('')
  expect(stdout).toEqual('esm d\nesm a\nesm b\nesm browser c\nesm lib\n')

  let buffer = await readFile(bundle)
  expect(buffer.toString()).not.toContain('shaked-export')
})

it('works with require in webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${ lib }`, { cwd: client })
  await exec(`yarn add client-lib@${ clientLib }`, { cwd: client })

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
  let [lib] = await copyDirs('require-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual('Unsupported require() at index.js:2:2')
})

it('throws on un-processed exports', async () => {
  let [lib] = await copyDirs('export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual(
    'Replace module.exports.x to module.exports = { x } at index.js:1:1'
  )
})
