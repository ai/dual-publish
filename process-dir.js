let { dirname, join, sep } = require('path')
let { promisify } = require('util')
let lineColumn = require('line-column')
let globby = require('globby')
let fs = require('fs')

let writeFile = promisify(fs.writeFile)
let readFile = promisify(fs.readFile)

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
  if (/^["']..?(["']$|\/)/.test(path)) {
    if (/\/index\.js(["'])$/.test(path)) {
      path = path.replace(/\/index\.js(["'])$/, `/index.${ ext }$1`)
    } else if (/\/["']$/.test(path)) {
      path = path.replace(/["']$/, `index.${ ext }$&`)
    } else {
      path = path.replace(/["']$/, `/index.${ ext }$&`)
    }
  }
  return path
}

function replaceRequire (source, exports, named, nameless) {
  return source
    .toString()
    .split('\n')
    .map(line => line
      .replace(/^module.exports\s*=\s*/, exports)
      .replace(/^(let|const|var)\s+(\S+)\s+=\s+require\(([^)]+)\)/g, named)
      .replace(/^require\(([^)]+)\)/g, nameless)
    )
    .join('\n')
}

async function replaceToESM (dir, file, source) {
  let esm = replaceRequire(
    source,
    'export default ',
    named => {
      let name = named.match(/(let|const|var)\s+(\S+)\s+=/)[2]
      let path = getPath(file, named, 'js')
      return `import ${ name } from ${ path }`
    },
    nameless => {
      let path = getPath(file, nameless, 'js')
      return `import ${ path }`
    }
  )

  let index = esm.search(/(\W|^)require\(/)
  if (index !== -1) {
    let { line, col } = lineColumn(esm).fromIndex(index)
    throw error(`Unsupported require() at ${ file }:${ line }:${ col }`)
  }

  await writeFile(join(dir, file), esm)
}

async function replaceToCJS (dir, file, source) {
  let cjs = replaceRequire(
    source,
    '$&',
    named => {
      let [, prefix, name] = named.match(/(let\s+|const\s+|var\s+)(\S+)\s+=/)
      let path = getPath(file, named, 'cjs')
      return `${ prefix }${ name } = require(${ path })`
    },
    nameless => {
      let path = getPath(file, nameless, 'cjs')
      return `require(${ path })`
    }
  )
  await writeFile(join(dir, file.replace(/\.js$/, '.cjs')), cjs)
}

async function replacePackage (dir, file) {
  let packageJson = join(dir, dirname(file), 'package.json')
  let packageData = { }
  if (fs.existsSync(packageJson)) {
    packageData = JSON.parse(await readFile(packageJson))
  }
  packageData.type = 'module'
  packageData.main = 'index.cjs'
  packageData.module = 'index.js'
  await writeFile(packageJson, JSON.stringify(packageData, null, 2))
}

module.exports = async function (dir) {
  let npmignorePath = join(dir, '.npmignore')
  let ignore = []
  if (fs.existsSync(npmignorePath)) {
    ignore = await readFile(npmignorePath)
    ignore = ignore.toString().split('\n').filter(i => !!i).map(i => {
      return i.endsWith(sep) ? i.slice(0, -1) : i
    })
  }

  let files = await globby('**/*.js', { ignore, cwd: dir })

  for (let file of files) {
    if (!/(^|\/|\\)index(\.browser|\.rn)?\.js/.test(file)) {
      let fixed = file.replace(/\.js$/, sep + 'index.js')
      throw error(`Rename ${ file } to ${ fixed }`)
    }
  }

  await Promise.all(files.map(async file => {
    let source = await readFile(join(dir, file))
    if (file.endsWith('index.browser.js')) {
      await replaceToESM(dir, file, source)
    } else {
      await Promise.all([
        replaceToCJS(dir, file, source),
        replaceToESM(dir, file, source),
        replacePackage(dir, file)
      ])
    }
  }))
}
