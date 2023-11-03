import browserify from 'browserify'
import glob from 'fast-glob'
import fse from 'fs-extra'
import { nanoid } from 'nanoid/non-secure'
import { deepStrictEqual, doesNotMatch, equal, match, ok } from 'node:assert'
import child from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import webpack from 'webpack'

import { processDir } from '../process-dir.js'

let exec = promisify(child.exec)

let toClean = []

afterEach(() => Promise.all(toClean.map(i => fse.remove(i))))

let esmNode = 'node '
let nodeVersion = parseInt(process.version.slice(1))
if (nodeVersion === 12) {
  esmNode = 'node --experimental-modules '
}

let testRoot = dirname(fileURLToPath(import.meta.url))

function copyDirs(...dirs) {
  return Promise.all(
    dirs.map(async dir => {
      let tmp = join(tmpdir(), `dual-publish-${dir}-${nanoid()}`)
      await fse.copy(join(testRoot, 'fixtures', dir), tmp)
      toClean.push(tmp)
      return tmp
    })
  )
}

async function replaceConsole(dir) {
  let files = await glob('**/*.js', { cwd: dir, absolute: true })
  await Promise.all(
    files
      .filter(i => !i.includes('.cjs.'))
      .map(async i => {
        let source = await fse.readFile(i)
        let fixed = source.toString().replace(/'cjs /g, "'esm ")
        await fse.writeFile(i, fixed)
      })
  )
}

async function buildWithWebpack(path, extra = {}) {
  let bundler = webpack({
    mode: 'production',
    entry: join(path),
    output: {
      path: dirname(path)
    },
    resolve: {
      fallback: {
        path: false,
        util: false
      }
    },
    ...extra
  })
  await new Promise((resolve, reject) => {
    bundler.run((err, stats) => {
      if (err) {
        reject(err)
      } else if (stats.hasErrors()) {
        reject(stats.toJson().errors[0].message)
      } else {
        resolve()
      }
    })
  })
  return join(dirname(path), 'main.js')
}

test('compiles for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'), {
    env: { NODE_ENV: 'development' }
  })
  equal(cjs.stderr, '')
  equal(
    cjs.stdout,
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-dev\ncjs g-node-dev\n'
  )

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'), {
      env: { NODE_ENV: 'development' }
    })
    equal(esm.stderr, '')
    equal(
      esm.stdout,
      'esm d\nesm a\nesm b\nesm c\nesm lib\nesm f-dev\nesm g-node-dev\n'
    )
  }
})

test('compiles for production Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'), {
    env: { NODE_ENV: 'production' }
  })
  equal(cjs.stderr, '')
  equal(
    cjs.stdout,
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-prod\ncjs g-node-prod\n'
  )

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'), {
      env: { NODE_ENV: 'development' }
    })
    equal(esm.stderr, '')
    equal(
      esm.stdout,
      'esm d\nesm a\nesm b\nesm c\nesm lib\nesm f-dev\nesm g-node-dev\n'
    )
  }
})

test('compiles default export for Node.js', async () => {
  let [lib, runner] = await copyDirs('default-lib', 'default-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  equal(cjs.stdout, 'cjs a\ncjs lib\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'))
    equal(esm.stdout, 'esm a\nesm lib\n')
  }
})

test('allows to use sub-files for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'subfile.cjs'))
  equal(cjs.stdout, 'cjs a\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'subfile.mjs'))
    equal(esm.stdout, 'esm a\n')
  }
})

test('reads package.files', async () => {
  let [lib] = await copyDirs('files')
  await processDir(lib)
})

test('reads package.bin', async () => {
  let [lib1, lib2] = await copyDirs('bin1', 'bin2')
  await Promise.all([processDir(lib1), processDir(lib2)])
})

test('throws on non-index file', async () => {
  let [lib] = await copyDirs('non-index-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  equal(err.message, 'Rename file.js to file/index.js')
})

test('throws on index require without .js', async () => {
  let [lib] = await copyDirs('non-js-index-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  equal(err.message, 'Replace `index` in require() to `index.js` at index.js')
})

test('throws on un-processed require', async () => {
  let [lib] = await copyDirs('require-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  equal(
    err.message,
    'Unsupported require() at index.js:2:2.\n' +
      'ESM supports only top-level require with static path.'
  )
})

test('throws on un-processed export', async () => {
  let [lib] = await copyDirs('named-export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  match(err.message, /Unsupported export at index.js:1:1/)
})

test('throws on un-processed multiline export', async () => {
  let [lib] = await copyDirs('multiline-export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  match(err.message, /Unsupported export at index.js:1:1/)
})

test('throws on un-processed exports', async () => {
  let [lib] = await copyDirs('export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  equal(
    err.message,
    'Replace module.exports.x to module.exports = { x } at index.js:1:1'
  )
})

test('compiles for TypeScript', async () => {
  let [lib, runner] = await copyDirs('lib', 'ts-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })
  await exec('npx tsc --build ' + join(runner, 'tsconfig.json'))
})

test('works with ts-node', async () => {
  let [lib, runner] = await copyDirs('lib', 'ts-node')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })
  let { stdout } = await exec('npx ts-node ' + join(runner, 'index.ts'))
  equal(
    stdout,
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-dev\ncjs g-node-dev\n'
  )
})

test('works with modules in webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'))

  let str = (await fse.readFile(bundle)).toString()
  doesNotMatch(str, /shaked-export/)
  doesNotMatch(str, /cjs/)
  match(str, /esm d/)
  match(str, /esm a/)
  match(str, /esm b/)
  match(str, /esm browser c/)
  match(str, /esm lib/)
  match(str, /esm f-prod/)
  match(str, /esm g-browser-prod/)
  doesNotMatch(str, /esm f-dev/)
})

test('works with modules in esbuild', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let bundle = join(runner, 'bundle.js')
  await exec(
    `npx esbuild --bundle ${join(runner, 'index.mjs')} ` +
      `--minify --outfile=${bundle} ` +
      `--define:process.env.NODE_ENV='"production"' ` +
      `--external:path --external:util`
  )

  let str = (await fse.readFile(bundle)).toString()
  doesNotMatch(str, /shaked-export/)
  doesNotMatch(str, /cjs/)
  match(str, /esm d/)
  match(str, /esm a/)
  match(str, /esm b/)
  match(str, /esm browser c/)
  match(str, /esm lib/)
  match(str, /esm f-prod/)
  match(str, /esm g-browser-prod/)
  doesNotMatch(str, /esm f-dev/)
})

test('works with modules in development webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'), {
    mode: 'development'
  })

  let str = (await fse.readFile(bundle)).toString()
  match(str, /esm f-dev/)
  match(str, /esm g-browser-dev/)
  doesNotMatch(str, /esm f-prod/)
})

test('works with modules in Rollup', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  let bundle = join(client, 'bundle.js')
  await exec(
    `npx rollup ${join(client, 'index.js')} ` +
      `-o ${bundle} -f es ` +
      '-p @rollup/plugin-node-resolve={browser:true} ' +
      '-p rollup-plugin-svg ' +
      '-p @rollup/plugin-replace=\'{"process.env.NODE_ENV":"\\"production\\""}\' ' +
      '-p rollup-plugin-terser'
  )

  let str = (await fse.readFile(bundle)).toString()
  doesNotMatch(str, /shaked-export/)
  doesNotMatch(str, /cjs/)
  match(str, /esm d/)
  match(str, /esm a/)
  match(str, /esm b/)
  match(str, /esm browser c/)
  match(str, /esm lib/)
  match(str, /esm f-prod/)
  match(str, /esm g-browser-prod/)
  doesNotMatch(str, /esm f-dev/)
})

test('works with modules in Parcel', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  await exec(
    `npx parcel build ${join(client, 'index.js')} ` +
      `-d ${client} -o bundle.js --no-cache --experimental-scope-hoisting`,
    { env: { ...process.env, NODE_ENV: 'production' } }
  )

  let str = (await fse.readFile(join(client, 'bundle.js'))).toString()
  doesNotMatch(str, /shaked-export/)
  doesNotMatch(str, /cjs/)
  match(str, /esm d/)
  match(str, /esm a/)
  match(str, /esm b/)
  match(str, /esm browser c/)
  match(str, /esm lib/)
  match(str, /esm f-prod/)
  match(str, /esm g-browser-prod/)
  doesNotMatch(str, /esm f-dev/)
})

test('works with modules in developer Parcel', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  await exec(
    `npx parcel build ${join(client, 'index.js')} ` +
      `-d ${client} -o bundle.js --no-cache --experimental-scope-hoisting`,
    { env: { ...process.env, NODE_ENV: 'development' } }
  )

  let str = (await fse.readFile(join(client, 'bundle.js'))).toString()
  match(str, /esm f-dev/)
  match(str, /esm g-browser-dev/)
  doesNotMatch(str, /esm f-prod/)
})

test('copy package.json fields as a conditions for exports field', async () => {
  let [normalizeCss] = await copyDirs('normalize-css')
  await processDir(normalizeCss)
  let pkg = await fse.readFile(join(normalizeCss, 'package.json'))
  deepStrictEqual(JSON.parse(pkg.toString()), {
    'name': 'normalize-css',
    'style': './index.css',
    'styl': './index.css',
    'sass': './dir/index.sass',
    'less': './dir/index.less',
    'type': 'module',
    'main': 'index.cjs',
    'module': 'index.js',
    'react-native': 'index.js',
    'exports': {
      '.': {
        default: './index.js',
        require: './index.cjs',
        import: './index.js',
        style: './index.css',
        styl: './index.css',
        sass: './dir/index.sass',
        less: './dir/index.less'
      },
      './package.json': './package.json',
      './index.css': './index.css',
      './dir/index.sass': './dir/index.sass',
      './dir/index.less': './dir/index.less'
    }
  })
})

test('supports process.env.NODE_ENV', async () => {
  let [nodeEnv] = await copyDirs('node-env')
  await processDir(nodeEnv)
  await replaceConsole(nodeEnv)
  let packageJsonContent = JSON.parse(
    (await fse.readFile(join(nodeEnv, 'package.json'))).toString()
  )
  deepStrictEqual(packageJsonContent.exports['.'], {
    browser: {
      production: './index.prod.js',
      development: './index.dev.js',
      default: './index.prod.js'
    },
    import: './index.js',
    require: './index.cjs',
    default: './index.js'
  })

  deepStrictEqual(packageJsonContent.exports['./a'], {
    browser: {
      production: './a/index.prod.js',
      development: './a/index.dev.js',
      default: './a/index.prod.js'
    },
    require: './a/index.cjs',
    import: './a/index.js',
    default: './a/index.js'
  })

  let nestedPackageJsonContent = JSON.parse(
    (await fse.readFile(join(nodeEnv, 'a/package.json'))).toString()
  )

  deepStrictEqual(nestedPackageJsonContent, {
    'browser': {
      './index.cjs': './index.browser.cjs',
      './index.js': './index.browser.js'
    },
    'main': 'index.cjs',
    'module': 'index.js',
    'react-native': 'index.js',
    'type': 'module'
  })

  let indexDerivedProd = (
    await fse.readFile(join(nodeEnv, 'index.prod.js'))
  ).toString()
  let indexDerivedDev = (
    await fse.readFile(join(nodeEnv, 'index.dev.js'))
  ).toString()
  let browserDerivedProd = (
    await fse.readFile(join(nodeEnv, 'a/index.prod.js'))
  ).toString()
  let browserDerivedDev = (
    await fse.readFile(join(nodeEnv, 'a/index.dev.js'))
  ).toString()
  ok(indexDerivedDev.includes('if (false) {'))
  ok(indexDerivedDev.includes('if (2+3||true&& 2 + 2) {'))
  ok(indexDerivedProd.includes('if (true) {'))
  ok(indexDerivedProd.includes('if (2+3||false&& 2 + 2) {'))

  ok(
    indexDerivedProd.includes(
      'if (true&&false\n' +
        '  ||\n' +
        '  true\n' +
        '  &&false\n' +
        '  ||true&&false\n' +
        ') {\n' +
        "  console.log('dev mode')\n" +
        '}'
    )
  )
  ok(
    indexDerivedDev.includes(
      'if (false&&true\n' +
        '  ||\n' +
        '  false\n' +
        '  &&true\n' +
        '  ||false&&true\n' +
        ') {\n' +
        "  console.log('dev mode')\n" +
        '}'
    )
  )

  ok(indexDerivedDev.includes('false||1'))
  ok(indexDerivedProd.includes('true||1'))

  ok(browserDerivedDev.includes("console.log('esm browser a')"))
  ok(browserDerivedDev.includes('if (true) {'))
  ok(browserDerivedProd.includes("console.log('esm browser a')"))
  ok(browserDerivedProd.includes('if (false) {'))

  ok(browserDerivedProd.includes("console.log('esm browser a')"))
  ok(browserDerivedProd.includes('if (false) {'))
})

test('supports Browserify', async () => {
  let [lib, client] = await copyDirs('lib', 'client-cjs')

  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })

  let b = browserify(join(client, 'index.js'))
  let str = await new Promise((resolve, reject) => {
    b.bundle((err, src) => {
      if (err) {
        reject(err)
      } else {
        resolve(src)
      }
    })
  })
  let runner = join(client, 'runner.js')
  await fse.writeFile(runner, str)

  let cjs = await exec('node ' + runner)
  equal(cjs.stderr, '')
  equal(
    cjs.stdout,
    'cjs d\ncjs a\ncjs b\ncjs browser c\n' +
      'cjs lib\ncjs f-dev\ncjs g-browser-dev\n'
  )
})
