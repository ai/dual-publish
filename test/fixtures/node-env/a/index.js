function a () {
  console.log('cjs a')
  if (process.env.NODE_ENV !== "production") {
  }
}

module.exports = { a, toShare }
