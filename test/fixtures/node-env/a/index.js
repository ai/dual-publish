function a () {
  console.log('cjs a')
  if (process.env.NODE_ENV !== "production") {
    console.log('cjs a dev')
  }
}

module.exports = { a, toShare }
