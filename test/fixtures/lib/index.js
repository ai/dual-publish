let { promisify } = require('util')
let path = require('path')

const { a } = require('./a')
let { b } = require('./b/index.js')
var { c } = require('./c/')
require('./d')

function lib () {
  a(path.join('a', 'b'))
  b()
  c()
  console.log('cjs lib')
}

module.exports = { lib }
