let { promisify } = require('util')
let path = require('path')

const { a } = require('./a')
let {
  b
} = require('./b/index.js')
var { c: cname } = require('./c/')
require('./d')

let { f } = require('./f')
let { g } = require('./g')

function lib () {
  a(path.join('a', 'b'))
  b()
  cname()
  console.log('cjs lib')
  console.log(f + '\n' + g)
}

module.exports = { lib }
