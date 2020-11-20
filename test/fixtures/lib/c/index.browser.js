function c () {
  console.log('cjs browser c')
  if (process.env.NODE_ENV !=="production") {
  }
}

module.exports  = { c }
