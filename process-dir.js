let { dirname, join, sep } = require('path')
let { promisify } = require('util')
let lineColumn = require('line-column')
let globby = require('globby')
let rimraf = promisify(require('rimraf'))
let fs = require('fs')

let writeFile = promisify(fs.writeFile)
let readFile = promisify(fs.readFile)
let lstat = promisify(fs.lstat)
let readdir = promisify(fs.readdir)

const NAME = /(^|\n)(let\s+|const\s+|var\s+)(\S+|{[^}]+})\s*=/m

function error (msg) {
  let err = new Error(msg)
  err.own = true
  return err
}

function getPath (file, statement, ext) {
  let path = statement.match(/require\(([^)]+)\)/)[1]
  if (/\/index["']/.test(path)) {
    throw error('Replace `index` in require() to `index.js` at ' + file)
  }
  if (/\.(svg|png|css|sass)["']$/.test(path)) {
    return path
  } else if (/^["']\.\.?(["']$|\/)/.test(path)) {
    if (/\/index\.js(["'])$/.test(path)) {
      return path.replace(/\/index\.js(["'])$/, `/index.${ext}$1`)
    } else if (/\/["']$/.test(path)) {
      return path.replace(/["']$/, `index.${ext}$&`)
    } else {
      return path.replace(/["']$/, `/index.${ext}$&`)
    }
  } else {
    return path
  }
}

function extractPrefix (str) {
  if (str[0] === '\n') {
    return '\n'
  } else {
    return ''
  }
}

function replaceRequire (source, exported, named, nameless) {
  return source
    .toString()
    .replace(/(^|\n)module.exports\s*=\s*\S/g, str =>
      exported(str, extractPrefix(str), str.slice(-1))
    )
    .replace(
      /(^|\n)(let|const|var)\s+({[^}]+}|\S+)\s*=\s*require\([^)]+\)/g,
      str => {
        let [, prefix, varType, name] = str.match(NAME)
        return named(str, prefix, varType, name)
      }
    )
    .replace(/(^|\n)require\(([^)]+)\)/g, str =>
      nameless(str, extractPrefix(str))
    )
}

async function replaceToESM (dir, file, buffer) {
  let src = buffer.toString()
  let wrongExportIndex = src.search(/module\.exports\s*=\s*{\s*\w+:/)
  if (wrongExportIndex !== -1) {
    let { line, col } = lineColumn(src).fromIndex(wrongExportIndex)
    throw error(
      `Unsupported export at ${file}:${line}:${col}.\n` +
        'Use named export like:\n' +
        '  const prop = 1;\n' +
        '  function method () { … }\n' +
        '  module.exports = { prop, method }'
    )
  }

  let esm = replaceRequire(
    src,
    (exported, prefix, postfix) => {
      if (postfix === '{') {
        return `${prefix}export ${postfix}`
      } else {
        return `${prefix}export default ${postfix}`
      }
    },
    (named, prefix, varType, name) => {
      let path = getPath(file, named, 'js')
      name = name.replace(/\s*:\s*/, ' as ')
      return `${prefix}import ${name} from ${path}`
    },
    (nameless, prefix) => {
      let path = getPath(file, nameless, 'js')
      return `${prefix}import ${path}`
    }
  )

  let requireIndex = esm.search(/(\W|^)require\(/)
  if (requireIndex !== -1) {
    let { line, col } = lineColumn(esm).fromIndex(requireIndex)
    throw error(
      `Unsupported require() at ${file}:${line}:${col}.\n` +
        'ESM supports only top-level require with static path.'
    )
  }

  let exportIndex = esm.search(/(\W|^)(module\.)?exports\./)
  if (exportIndex !== -1) {
    let { line, col } = lineColumn(esm).fromIndex(exportIndex)
    throw error(
      'Replace module.exports.x to module.exports = { x } ' +
        `at ${file}:${line}:${col}`
    )
  }

  await writeFile(join(dir, file), esm)
  return [file, esm]
}

async function replaceToCJS (dir, file, source) {
  let cjs = replaceRequire(
    source,
    exported => exported,
    (named, prefix, varType, name) => {
      let path = getPath(file, named, 'cjs')
      return `${prefix}${varType}${name} = require(${path})`
    },
    (nameless, prefix) => {
      let path = getPath(file, nameless, 'cjs')
      return `${prefix}require(${path})`
    }
  )
  await writeFile(join(dir, file.replace(/\.js$/, '.cjs')), cjs)
}

async function replacePackage (dir, file, files, envTargets) {
  let pkgFile = join(dir, dirname(file), 'package.json')
  let pkg = {}
  if (fs.existsSync(pkgFile)) {
    pkg = JSON.parse(await readFile(pkgFile))
  }
  pkg.type = 'module'
  pkg.main = 'index.cjs'
  pkg.module = 'index.js'
  pkg['react-native'] = 'index.js'

  if (files.includes(file.replace(/\.js$/, '.browser.js'))) {
    pkg.browser = {
      './index.js': './index.browser.js'
    }
  }
  if (files.includes(file.replace(/\.js$/, '.native.js'))) {
    pkg['react-native'] = {
      './index.js': './index.native.js'
    }
  }
  if (file === 'index.js') {
    pkg.exports = {}
    pkg.exports['.'] = {}
    for (let i of files) {
      let path = '.'
      if (i.endsWith('.browser.js') || i.endsWith('.native.js')) continue
      if (i !== 'index.js') path += '/' + dirname(i).replace(/\\/g, '/')
      pkg.exports[path + '/package.json'] = path + '/package.json'
      if (!pkg.exports[path]) pkg.exports[path] = {}
      if (
        envTargets.includes(i) ||
        envTargets.includes(i.replace(/\.js$/, '.browser.js'))
      ) {
        pkg.exports[path].browser = {
          development: path + '/index.dev.js',
          production: path + '/index.prod.js'
        }
      } else if (files.includes(i.replace(/\.js$/, '.browser.js'))) {
        pkg.exports[path].browser = path + '/index.browser.js'
      }
      pkg.exports[path].require = path + '/index.cjs'
      pkg.exports[path].import = path + '/index.js'
    }

    for (let type of ['types', 'style', 'styl', 'sass', 'less']) {
      if (pkg[type]) {
        pkg.exports[pkg[type]] = pkg[type]
        pkg.exports['.'][type] = pkg[type]
      }
    }
  }

  await writeFile(pkgFile, JSON.stringify(pkg, null, 2))
}

function hasEnvCondition (source) {
  return /process.env.NODE_ENV\s*[!=]==?\s*["'`](production|development)["'`]/.test(
    source
  )
}

async function replaceEnvConditions (dir, file, source) {
  source = source.toString()
  let prodCondition = /process.env.NODE_ENV\s*(===?\s*["'`]production["'`]|!==?\s*["'`]development["'`])/g
  let devCondition = /process.env.NODE_ENV\s*(!==?\s*["'`]production["'`]|===?\s*["'`]development["'`])/g
  let prod = source
    .replace(prodCondition, () => 'true')
    .replace(devCondition, () => 'false')
  let dev = source
    .replace(prodCondition, () => 'false')
    .replace(devCondition, () => 'true')

  let devFile = join(dirname(file), 'index.dev.js')
  let prodFile = join(dirname(file), 'index.prod.js')

  await writeFile(join(dir, devFile), dev)
  await writeFile(join(dir, prodFile), prod)
  return [devFile, prodFile]
}

function findEnvTargets (sources) {
  let browserJs = sources.filter(([file]) => file.endsWith('index.browser.js'))
  let dirsWithBrowserJs = browserJs.map(([file]) => dirname(file))
  let onlyIndexJs = sources.filter(
    ([file]) =>
      file.endsWith('index.js') && !dirsWithBrowserJs.includes(dirname(file))
  )
  return [...browserJs, ...onlyIndexJs]
    .filter(([, source]) => hasEnvCondition(source))
    .map(([file]) => file)
}

async function process (dir) {
  let ignorePatterns = []
  let removePatterns = []

  let npmignorePath = join(dir, '.npmignore')
  if (fs.existsSync(npmignorePath)) {
    removePatterns = (await readFile(npmignorePath))
      .toString()
      .split('\n')
      .filter(i => !!i)
      .map(i => (i.endsWith(sep) ? i.slice(0, -1) : i))
  }

  removePatterns.push('**/*.test.js', '**/*.spec.js')

  let removeFiles = await globby(removePatterns, { cwd: dir })
  await Promise.all(removeFiles.map(i => rimraf(join(dir, i))))
  await removeEmpty(dir)

  let pattern = '**/*.js'

  let pkgPath = join(dir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    let pkg = JSON.parse(await readFile(pkgPath))
    if (pkg.files) {
      pattern = pkg.files
    }
    if (typeof pkg.bin === 'string') {
      ignorePatterns.push(pkg.bin)
    } else if (typeof pkg.bin === 'object') {
      ignorePatterns.push(...Object.values(pkg.bin))
    }
  }

  let all = await globby(pattern, { ignore: ignorePatterns, cwd: dir })

  let sources = await Promise.all(
    all.map(async file => {
      let source = await readFile(join(dir, file))
      return [file, source]
    })
  )

  sources = sources.filter(([file, source]) => {
    if (/(^|\/|\\)index(\.browser|\.native)?\.js/.test(file)) {
      return true
    } else if (/(^|\n)export /.test(source)) {
      return false
    } else {
      let fixed = file.replace(/\.js$/, sep + 'index.js')
      throw error(`Rename ${file} to ${fixed}`)
    }
  })
  let files = sources.map(([file]) => file)
  let envTargets = findEnvTargets(sources)

  await Promise.all(
    sources.map(async ([file, source]) => {
      if (file.endsWith('index.browser.js')) {
        let [, modifiedSource] = await replaceToESM(dir, file, source)
        if (envTargets.includes(file)) {
          await replaceEnvConditions(dir, file, modifiedSource)
        }
      } else if (file.endsWith('index.native.js')) {
        await replaceToESM(dir, file, source)
      } else {
        await Promise.all([
          replaceToCJS(dir, file, source),
          (async () => {
            let [, modifiedSource] = await replaceToESM(dir, file, source)
            if (envTargets.includes(file)) {
              await replaceEnvConditions(dir, file, modifiedSource)
            }
          })(),
          replacePackage(dir, file, files, envTargets)
        ])
      }
    })
  )
}

async function removeEmpty (dir) {
  if (!(await lstat(dir)).isDirectory()) return

  let entries = await readdir(dir)
  if (entries.length > 0) {
    await Promise.all(entries.map(i => removeEmpty(join(dir, i))))
    entries = await readdir(dir)
  }

  if (entries.length === 0) {
    await rimraf(dir)
  }
}

module.exports = async function processDir (dir) {
  try {
    await process(dir)
  } catch (e) {
    await rimraf(dir)
    throw e
  }
}
