let { remove, copy, readFile, writeFile } = require('fs-extra')
let { join, dirname } = require('path')
let { promisify } = require('util')
let { nanoid } = require('nanoid/non-secure')
let { tmpdir } = require('os')
let webpack = require('webpack')
let globby = require('globby')
let metro = require('metro')
let child = require('child_process')

let processDir = require('../process-dir')

let exec = promisify(child.exec)

let toClean = []

afterEach(() => Promise.all(toClean.map(i => remove(i))))

jest.setTimeout(15000)

let esmNode = 'node '
if (process.version.startsWith('v12.')) {
  esmNode = 'node --experimental-modules '
}

function copyDirs(...dirs) {
  return Promise.all(
    dirs.map(async dir => {
      let tmp = join(tmpdir(), `dual-publish-${dir}-${nanoid()}`)
      await copy(join(__dirname, 'fixtures', dir), tmp)
      toClean.push(tmp)
      return tmp
    })
  )
}

async function replaceConsole(dir) {
  let files = await globby('**/*.js', { cwd: dir, absolute: true })
  await Promise.all(
    files
      .filter(i => !i.includes('.cjs.'))
      .map(async i => {
        let source = await readFile(i)
        let fixed = source.toString().replace(/'cjs /g, "'esm ")
        await writeFile(i, fixed)
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

it('compiles for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'), {
    env: { NODE_ENV: 'development' }
  })
  expect(cjs.stderr).toEqual('')
  expect(cjs.stdout).toEqual(
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-dev\ncjs g-node-dev\n'
  )

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'), {
      env: { NODE_ENV: 'development' }
    })
    expect(esm.stderr).toEqual('')
    expect(esm.stdout).toEqual(
      'esm d\nesm a\nesm b\nesm c\nesm lib\nesm f-dev\nesm g-node-dev\n'
    )
  }
})

it('compiles for production Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'), {
    env: { NODE_ENV: 'production' }
  })
  expect(cjs.stderr).toEqual('')
  expect(cjs.stdout).toEqual(
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-prod\ncjs g-node-prod\n'
  )

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'), {
      env: { NODE_ENV: 'development' }
    })
    expect(esm.stderr).toEqual('')
    expect(esm.stdout).toEqual(
      'esm d\nesm a\nesm b\nesm c\nesm lib\nesm f-dev\nesm g-node-dev\n'
    )
  }
})

it('compiles default export for Node.js', async () => {
  let [lib, runner] = await copyDirs('default-lib', 'default-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

  let cjs = await exec('node ' + join(runner, 'index.cjs'))
  expect(cjs.stdout).toEqual('cjs a\ncjs lib\n')

  if (!process.version.startsWith('v10.')) {
    let esm = await exec(esmNode + join(runner, 'index.mjs'))
    expect(esm.stdout).toEqual('esm a\nesm lib\n')
  }
})

it('allows to use sub-files for Node.js', async () => {
  let [lib, runner] = await copyDirs('lib', 'runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })

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

it('reads package.files', async () => {
  let [lib] = await copyDirs('files')
  await processDir(lib)
})

it('reads package.bin', async () => {
  let [lib1, lib2] = await copyDirs('bin1', 'bin2')
  await Promise.all([processDir(lib1), processDir(lib2)])
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
  expect(err.message).toEqual(
    'Unsupported require() at index.js:2:2.\n' +
      'ESM supports only top-level require with static path.'
  )
})

it('throws on un-processed export', async () => {
  let [lib] = await copyDirs('named-export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toContain('Unsupported export at index.js:1:1')
})

it('throws on un-processed multiline export', async () => {
  let [lib] = await copyDirs('multiline-export-error')
  let err
  try {
    await processDir(lib)
  } catch (e) {
    err = e
  }
  expect(err.message).toContain('Unsupported export at index.js:1:1')
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

it('compiles for TypeScript', async () => {
  let [lib, runner] = await copyDirs('lib', 'ts-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })
  await exec('npx tsc --build ' + join(runner, 'tsconfig.json'))
})

it('works with ts-node', async () => {
  let [lib, runner] = await copyDirs('lib', 'ts-node')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: runner })
  let { stdout } = await exec('npx ts-node ' + join(runner, 'index.ts'))
  expect(stdout).toEqual(
    'cjs d\ncjs a\ncjs b\ncjs c\ncjs lib\ncjs f-dev\ncjs g-node-dev\n'
  )
})

it('works with modules in webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'))

  let str = (await readFile(bundle)).toString()
  expect(str).not.toContain('shaked-export')
  expect(str).not.toContain('cjs')
  expect(str).toContain('esm d')
  expect(str).toContain('esm a')
  expect(str).toContain('esm b')
  expect(str).toContain('esm browser c')
  expect(str).toContain('esm lib')
  expect(str).toContain('esm f-prod')
  expect(str).toContain('esm g-browser-prod')
  expect(str).not.toContain('esm f-dev')
})

it('works with modules in esbuild', async () => {
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

  let str = (await readFile(bundle)).toString()
  expect(str).not.toContain('shaked-export')
  expect(str).not.toContain('cjs')
  expect(str).toContain('esm d')
  expect(str).toContain('esm a')
  expect(str).toContain('esm b')
  expect(str).toContain('esm browser c')
  expect(str).toContain('esm lib')
  expect(str).toContain('esm f-prod')
  expect(str).toContain('esm g-browser-prod')
  expect(str).not.toContain('esm f-dev')
})

it('works with modules in development webpack', async () => {
  let [lib, clientLib, client] = await copyDirs('lib', 'client-lib', 'client')
  await processDir(lib)
  await processDir(clientLib)
  await replaceConsole(lib)
  await exec(`yarn add lib@${lib}`, { cwd: client })
  await exec(`yarn add client-lib@${clientLib}`, { cwd: client })

  let bundle = await buildWithWebpack(join(client, 'index.js'), {
    mode: 'development'
  })

  let str = (await readFile(bundle)).toString()
  expect(str).toContain('esm f-dev')
  expect(str).toContain('esm g-browser-dev')
  expect(str).not.toContain('esm f-prod')
})

it('works with modules in Rollup', async () => {
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

  let str = (await readFile(bundle)).toString()
  expect(str).not.toContain('shaked-export')
  expect(str).not.toContain('cjs')
  expect(str).toContain('esm d')
  expect(str).toContain('esm a')
  expect(str).toContain('esm b')
  expect(str).toContain('esm browser c')
  expect(str).toContain('esm lib')
  expect(str).toContain('esm f-prod')
  expect(str).toContain('esm g-browser-prod')
  expect(str).not.toContain('esm f-dev')
})

it('works with modules in Parcel', async () => {
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

  let str = (await readFile(join(client, 'bundle.js'))).toString()
  expect(str).not.toContain('shaked-export')
  expect(str).not.toContain('cjs')
  expect(str).toContain('esm d')
  expect(str).toContain('esm a')
  expect(str).toContain('esm b')
  expect(str).toContain('esm browser c')
  expect(str).toContain('esm lib')
  expect(str).toContain('esm f-prod')
  expect(str).toContain('esm g-browser-prod')
  expect(str).not.toContain('esm f-dev')
})

it('works with modules in developer Parcel', async () => {
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

  let str = (await readFile(join(client, 'bundle.js'))).toString()
  expect(str).toContain('esm f-dev')
  expect(str).toContain('esm g-browser-dev')
  expect(str).not.toContain('esm f-prod')
})

it('compiles for React Native', async () => {
  let [lib, runner] = await copyDirs('rn-lib', 'rn-runner')
  await processDir(lib)
  await replaceConsole(lib)
  await exec(`yarn add rn-lib@${lib}`, { cwd: runner })

  let config = {
    ...(await metro.loadConfig()),
    projectRoot: runner,
    watchFolders: [runner, join(__dirname, '..', 'node_modules')],
    reporter: { update: () => {} },
    cacheStores: [],
    resetCache: true,
    resolver: {
      resolverMainFields: ['react-native', 'browser', 'main']
    },
    transformer: {
      babelTransformerPath: 'metro-react-native-babel-transformer'
    }
  }
  let { code } = await metro.runBuild(config, {
    entry: 'index.js',
    minify: false,
    sourceMap: false
  })
  expect(code).toContain("console.log('native a')")
  expect(code).toContain("console.log('esm b')")
  expect(code).toContain("console.log('esm c')")
})

it('copy package.json fields as a conditions for exports field', async () => {
  let [normalizeCss] = await copyDirs('normalize-css')
  await processDir(normalizeCss)
  let pkg = await readFile(join(normalizeCss, 'package.json'))
  expect(JSON.parse(pkg.toString())).toEqual({
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

it('supports process.env.NODE_ENV', async () => {
  let [nodeEnv] = await copyDirs('node-env')
  await processDir(nodeEnv)
  await replaceConsole(nodeEnv)
  let packageJsonContent = JSON.parse(
    (await readFile(join(nodeEnv, 'package.json'))).toString()
  )
  expect(packageJsonContent.exports['.']).toEqual({
    browser: {
      production: './index.prod.js',
      development: './index.dev.js',
      default: './index.prod.js'
    },
    import: './index.js',
    require: './index.cjs',
    default: './index.js'
  })

  expect(packageJsonContent.exports['./a']).toEqual({
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
    (await readFile(join(nodeEnv, 'a/package.json'))).toString()
  )

  expect(nestedPackageJsonContent).toEqual({
    'browser': {
      './index.js': './index.browser.js'
    },
    'main': 'index.cjs',
    'module': 'index.js',
    'react-native': 'index.js',
    'type': 'module'
  })

  let indexDerivedProd = (
    await readFile(join(nodeEnv, 'index.prod.js'))
  ).toString()
  let indexDerivedDev = (
    await readFile(join(nodeEnv, 'index.dev.js'))
  ).toString()
  let browserDerivedProd = (
    await readFile(join(nodeEnv, 'a/index.prod.js'))
  ).toString()
  let browserDerivedDev = (
    await readFile(join(nodeEnv, 'a/index.dev.js'))
  ).toString()
  expect(indexDerivedDev).toContain('if (false) {')
  expect(indexDerivedDev).toContain('if (2+3||true&& 2 + 2) {')
  expect(indexDerivedProd).toContain('if (true) {')
  expect(indexDerivedProd).toContain('if (2+3||false&& 2 + 2) {')

  expect(indexDerivedProd).toContain(
    'if (true&&false\n' +
      '  ||\n' +
      '  true\n' +
      '  &&false\n' +
      '  ||true&&false\n' +
      ') {\n' +
      "  console.log('dev mode')\n" +
      '}'
  )
  expect(indexDerivedDev).toContain(
    'if (false&&true\n' +
      '  ||\n' +
      '  false\n' +
      '  &&true\n' +
      '  ||false&&true\n' +
      ') {\n' +
      "  console.log('dev mode')\n" +
      '}'
  )

  expect(indexDerivedDev).toContain('false||1')
  expect(indexDerivedProd).toContain('true||1')

  expect(browserDerivedDev).toContain("console.log('esm browser a')")
  expect(browserDerivedDev).toContain('if (true) {')
  expect(browserDerivedProd).toContain("console.log('esm browser a')")
  expect(browserDerivedProd).toContain('if (false) {')

  expect(browserDerivedProd).toContain("console.log('esm browser a')")
  expect(browserDerivedProd).toContain('if (false) {')
})
