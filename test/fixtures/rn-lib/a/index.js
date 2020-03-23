let { b } = require('../b')
require('../c')

let a = () => {
  b()
  console.log('cjs a')
}

module.exports = { a }
