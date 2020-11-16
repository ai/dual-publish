function a () {
  console.log('cjs a')
  if (process.env.NODE_ENV !== "production") {
    console.log('cjs a')
  }
}

module.exports = { a, toShare }
