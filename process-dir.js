let { dirname, join, sep } = require('path')
let { promisify } = require('util')
let lineColumn = require('line-column')
let globby = require('globby')
let fs = require('fs')
let writeFile = promisify(fs.writeFile)
let readFile = promisify(fs.readFile)
let lstat = promisify(fs.lstat)
let readdir = promisify(fs.readdir)
let rimraf = promisify(require('rimraf'))

const NAME = /(^|\n)(let\s+|const\s+|var\s+)(\S+|{[^}]+})\s*=/m
const INDEX_JS = 'index.js'
const INDEX_CJS = 'index.cjs'
const BROWSER_JS = '.browser.js'
const INDEX_BROWSER_JS = 'index.browser.js'
const INDEX_NATIVE_JS = 'index.native.js'
const PACKAGE_JSON = 'package.json'
const OTHER_EXTENSIONS = ['types', 'style', 'styl', 'sass', 'less']
const ENV_PROD = 'process.env.NODE_ENV === "production"'
const ENV_NOT_PROD = 'process.env.NODE_ENV !== "production"'

const error = msg => {
  let err = new Error(msg)
  err.own = true
  return err
}

const getPath = (file, statement, ext) => {
  let [, path] = statement.match(/require\(([^)]+)\)/)

  if (/\/index["']/.test(path)) {
    throw error(`Replace \`index\` in require() to \`${INDEX_JS}\` at ${file}`)
  }

  if (/\.(svg|png|css|sass)["']$/.test(path)) return path

  if (/^["']\.\.?(["']$|\/)/.test(path)) {
    if (/\/index\.js(["'])$/.test(path)) {
      return path.replace(/\/index\.js(["'])$/, `/index.${ext}$1`)
    }
    if (/\/["']$/.test(path)) {
      return path.replace(/["']$/, `index.${ext}$&`)
    }

    return path.replace(/["']$/, `/index.${ext}$&`)
  }

  return path
}

const extractPrefix = str => {
  if (str[0] === '\n') {
    return '\n'
  }

  return ''
}

const replaceRequire = (source, exported, named, nameless) => {
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

const replaceToESM = async (dir, file, buffer) => {
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
      }

      return `${prefix}export default ${postfix}`
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
}

const replaceToCJS = async (dir, file, source) => {
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

const hasDotEnv = async pathToCurrentFile => {
  let buffer = await readFile(pathToCurrentFile)
  let string = buffer.toString()
  if (string.includes(ENV_PROD) || string.includes(ENV_NOT_PROD)) {
    return true
  }
  return false
}

const replaceAllFallback = (str, find, replace) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  return str.replace(new RegExp(find, 'g'), replace)
}

const processDotEnv = async pathToCurrentFile => {
  let pathToProd = pathToCurrentFile.replace(/\.browser.js$/, '.prod.js')
  let pathToDev = pathToCurrentFile.replace(/\.browser.js$/, '.dev.js')

  let buffer = await readFile(pathToCurrentFile)
  let string = buffer.toString()

  let isProd = string.includes(ENV_PROD)
  let isNotProd = string.includes(ENV_NOT_PROD)

  let prodModifiedToTrue = replaceAllFallback(string, ENV_PROD, 'true')
  let prodModifiedToFalse = replaceAllFallback(string, ENV_PROD, 'false')
  let notProdModifiedToTrue = replaceAllFallback(string, ENV_NOT_PROD, 'true')
  let notProdModifiedToFalse = replaceAllFallback(string, ENV_NOT_PROD, 'false')

  switch (true) {
    case isProd:
      await writeFile(pathToProd, prodModifiedToTrue)
      await writeFile(pathToDev, prodModifiedToFalse)
      break
    case isNotProd:
      await writeFile(pathToProd, notProdModifiedToTrue)
      await writeFile(pathToDev, notProdModifiedToFalse)
      break
    default:
      break
  }
}

const replacePackage = async (dir, file, files) => {
  let pkgFile = join(dir, dirname(file), PACKAGE_JSON)
  let pkg = {}

  if (fs.existsSync(pkgFile)) {
    pkg = JSON.parse(await readFile(pkgFile))
  }

  pkg.type = 'module'
  pkg.main = INDEX_CJS
  pkg.module = INDEX_JS
  pkg['react-native'] = INDEX_JS

  if (files.includes(file.replace(/\.js$/, BROWSER_JS))) {
    let pathToCurrentFile = join(dir, file.replace(/\.js$/, BROWSER_JS))

    if (await hasDotEnv(pathToCurrentFile)) {
      let browserPath = {
        production: './index.prod.js',
        development: './index.dev.js'
      }

      pkg.browser = browserPath
    } else {
      pkg.browser = `./${INDEX_BROWSER_JS}`
    }
  }

  if (files.includes(file.replace(/\.js$/, '.native.js'))) {
    pkg['react-native'] = {
      './index.js': `./${INDEX_NATIVE_JS}`
    }
  }

  if (file === INDEX_JS) {
    pkg.exports = {}
    pkg.exports['.'] = {}

    files.forEach(async i => {
      let path = '.'

      if (files.includes(i.replace(/\.js$/, BROWSER_JS))) {
        let pathToCurrentFile = join(dir, i.replace(/\.js$/, BROWSER_JS))

        if (await hasDotEnv(pathToCurrentFile)) {
          let browserPath = {
            production: `${path}/index.prod.js`,
            development: `${path}/index.dev.js`
          }
          pkg.exports[path].browser = browserPath
        } else {
          pkg.exports[path].browser = `${path}/${INDEX_BROWSER_JS}`
        }
      }

      if (i !== INDEX_JS) {
        path += '/' + dirname(i).replace(/\\/g, '/')
        pkg.exports[`${path}/${PACKAGE_JSON}`] = `${path}/${PACKAGE_JSON}`
      }

      if (!pkg.exports[path]) pkg.exports[path] = {}

      pkg.exports[path].require = `${path}/${INDEX_CJS}`
      pkg.exports[path].import = `${path}/${INDEX_JS}`
    })

    OTHER_EXTENSIONS.forEach(type => {
      if (pkg[type]) {
        pkg.exports[pkg[type]] = pkg[type]
        pkg.exports['.'][type] = pkg[type]
      }
    })
  }

  await writeFile(pkgFile, JSON.stringify(pkg, null, 2))
}

const removeEmpty = async dir => {
  if (!(await lstat(dir)).isDirectory()) return

  let entries = await readdir(dir)
  if (entries.length) {
    await Promise.all(entries.map(i => removeEmpty(join(dir, i))))
    return
  }

  await rimraf(dir)
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
  let pkgPath = join(dir, PACKAGE_JSON)

  if (fs.existsSync(pkgPath)) {
    let pkg = JSON.parse(await readFile(pkgPath))
    pattern = pkg.files || pattern

    switch (typeof pkg.bin) {
      case 'string':
        ignorePatterns.push(pkg.bin)
        break
      case 'object':
        ignorePatterns.push(...Object.values(pkg.bin))
        break
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
    }
    if (/(^|\n)export /.test(source)) {
      return false
    }

    let fixed = file.replace(/\.js$/, `${sep}${INDEX_JS}`)
    throw error(`Rename ${file} to ${fixed}`)
  })

  let files = []

  await Promise.all(
    sources.map(async ([file, source]) => {
      let pathToCurrentFile = join(dir, file)
      files.push(file)

      switch (true) {
        case file.endsWith(INDEX_BROWSER_JS):
          await processDotEnv(pathToCurrentFile)
          await replacePackage(dir, file, files)
          await replaceToESM(dir, file, source)
          break
        case file.endsWith(INDEX_JS):
          await processDotEnv(pathToCurrentFile)
          await replacePackage(dir, file, files)
          await replaceToCJS(dir, file, source)
          await replaceToESM(dir, file, source)
          break
        case file.endsWith(INDEX_NATIVE_JS):
          await replacePackage(dir, file, files)
          await replaceToESM(dir, file, source)
          break
        default:
          await Promise.all([
            replacePackage(dir, file, files),
            replaceToCJS(dir, file, source),
            replaceToESM(dir, file, source)
          ])
      }
    })
  )
}

module.exports = async function processDir (dir) {
  try {
    await process(dir)
  } catch (e) {
    await rimraf(dir)
    throw e
  }
}
