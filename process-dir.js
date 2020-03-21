let { dirname, join, sep } = require('path')
let { promisify } = require('util')
let lineColumn = require('line-column')
let globby = require('globby')
let rimraf = promisify(require('rimraf'))
let fs = require('fs')

let writeFile = promisify(fs.writeFile)
let readFile = promisify(fs.readFile)

const NAME = /(^|\n)(let\s+|const\s+|var\s+)(\S+|{[^}]+})\s*=/m

function error (msg) {
  let err = new Error(msg)
  err.own = true
  return err
}

function getPath (file, statement, ext) {
  let path = statement.match(/require\(([^)]+)\)/)[1]
  if (/\/index["']/.test(path)) {
    throw error(
      'Replace `index` in require() to `index.js` at ' + file
    )
  }
  if (/\.(svg|png|css|sass)["']$/.test(path)) {
    return path
  } else if (/^["']..?(["']$|\/)/.test(path)) {
    if (/\/index\.js(["'])$/.test(path)) {
      return path.replace(/\/index\.js(["'])$/, `/index.${ ext }$1`)
    } else if (/\/["']$/.test(path)) {
      return path.replace(/["']$/, `index.${ ext }$&`)
    } else {
      return path.replace(/["']$/, `/index.${ ext }$&`)
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
    .replace(
      /(^|\n)module.exports\s*=\s*\S/g,
      str => exported(str, extractPrefix(str), str.slice(-1))
    )
    .replace(
      /(^|\n)(let|const|var)\s+({[^}]+}|\S+)\s*=\s*require\([^)]+\)/g,
      str => {
        let [, prefix, varType, name] = str.match(NAME)
        return named(str, prefix, varType, name)
      }
    )
    .replace(
      /(^|\n)require\(([^)]+)\)/g,
      str => nameless(str, extractPrefix(str))
    )
}

async function replaceToESM (dir, file, source) {
  let esm = replaceRequire(
    source,
    (exported, prefix, postfix) => {
      if (postfix === '{') {
        return `${ prefix }export ${ postfix }`
      } else {
        return `${ prefix }export default ${ postfix }`
      }
    },
    (named, prefix, varType, name) => {
      let path = getPath(file, named, 'js')
      name = name.replace(/\s*:\s*/, ' as ')
      return `${ prefix }import ${ name } from ${ path }`
    },
    (nameless, prefix) => {
      let path = getPath(file, nameless, 'js')
      return `${ prefix }import ${ path }`
    }
  )

  let requireIndex = esm.search(/(\W|^)require\(/)
  if (requireIndex !== -1) {
    let { line, col } = lineColumn(esm).fromIndex(requireIndex)
    throw error(`Unsupported require() at ${ file }:${ line }:${ col }`)
  }

  let exportIndex = esm.search(/(\W|^)(module\.)?exports\./)
  if (exportIndex !== -1) {
    let { line, col } = lineColumn(esm).fromIndex(exportIndex)
    throw error(
      'Replace module.exports.x to module.exports = { x } ' +
      `at ${ file }:${ line }:${ col }`
    )
  }

  await writeFile(join(dir, file), esm)
}

async function replaceToOld (dir, file, source) {
  let cjs = replaceRequire(
    source,
    exported => exported,
    (named, prefix, varType, name) => {
      let path = getPath(file, named, 'cjs.js')
      return `${ prefix }${ varType }${ name } = require(${ path })`
    },
    (nameless, prefix) => {
      let path = getPath(file, nameless, 'cjs.js')
      return `${ prefix }require(${ path })`
    }
  )
  await writeFile(join(dir, file.replace(/\.js$/, '.cjs.js')), cjs)
}

async function replaceToCJS (dir, file, source) {
  let cjs = replaceRequire(
    source,
    exported => exported,
    (named, prefix, varType, name) => {
      let path = getPath(file, named, 'cjs')
      return `${ prefix }${ varType }${ name } = require(${ path })`
    },
    (nameless, prefix) => {
      let path = getPath(file, nameless, 'cjs')
      return `${ prefix }require(${ path })`
    }
  )
  await writeFile(join(dir, file.replace(/\.js$/, '.cjs')), cjs)
}

async function replacePackage (dir, file, files) {
  let pkgFile = join(dir, dirname(file), 'package.json')
  let pkg = { }
  if (fs.existsSync(pkgFile)) {
    pkg = JSON.parse(await readFile(pkgFile))
  }
  pkg.type = 'module'
  pkg.main = 'index.cjs'
  pkg.module = 'index.js'
  if (file === 'index.js') {
    pkg.exports = { }
    for (let i of files) {
      let path = '.'
      if (i.endsWith('.browser.js') || i.endsWith('.native.js')) continue
      if (i !== 'index.js') path += '/' + dirname(i).replace(/\\/g, '/')
      pkg.exports[path] = {
        require: path + '/index.cjs',
        import: path + '/index.js'
      }
      if (files.includes(i.replace(/\.js$/, '.browser.js'))) {
        pkg.exports[path].browser = path + '/index.browser.js'
      }
    }
  } else if (files.includes(file.replace(/\.js$/, '.browser.js'))) {
    pkg.browser = {
      'index.js': 'index.browser.js'
    }
  }
  if (files.includes(file.replace(/\.js$/, '.native.js'))) {
    pkg['react-native'] = 'index.native.js'
  } else {
    pkg['react-native'] = 'index.cjs.js'
  }
  await writeFile(pkgFile, JSON.stringify(pkg, null, 2))
}

async function process (dir) {
  let npmignorePath = join(dir, '.npmignore')
  let ignore = []
  if (fs.existsSync(npmignorePath)) {
    ignore = await readFile(npmignorePath)
    ignore = ignore.toString().split('\n').filter(i => !!i).map(i => {
      return i.endsWith(sep) ? i.slice(0, -1) : i
    })
  }

  ignore.push('**/*.test.js', '**/*.spec.js')

  let files = await globby('**/*.js', { ignore, cwd: dir })

  for (let file of files) {
    if (!/(^|\/|\\)index(\.browser|\.native)?\.js/.test(file)) {
      let fixed = file.replace(/\.js$/, sep + 'index.js')
      throw error(`Rename ${ file } to ${ fixed }`)
    }
  }

  await Promise.all(files.map(async file => {
    let source = await readFile(join(dir, file))
    if (file.endsWith('index.browser.js')) {
      await replaceToESM(dir, file, source)
    } else if (!file.endsWith('index.native.js')) {
      await Promise.all([
        replaceToCJS(dir, file, source),
        replaceToESM(dir, file, source),
        replacePackage(dir, file, files)
      ])
      if (!files.includes(file.replace(/\.js$/, '.native.js'))) {
        await replaceToOld(dir, file, source)
      }
    }
  }))
}

module.exports = async function processDir (dir) {
  try {
    await process(dir)
  } catch (e) {
    await rimraf(dir)
    throw e
  }
}
