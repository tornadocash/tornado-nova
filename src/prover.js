const { wtns } = require('snarkjs')
const { utils } = require('ffjavascript')

const fs = require('fs')
const tmp = require('tmp-promise')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

function prove(input, keyBasePath) {
  input = utils.stringifyBigInts(input)
  console.log('input', input)
  return tmp.dir().then(async (dir) => {
    dir = dir.path
    let out

    try {
      await wtns.debug(
        utils.unstringifyBigInts(input),
        `${keyBasePath}.wasm`,
        `${dir}/witness.wtns`,
        `${keyBasePath}.sym`,
        {},
        console,
      )
      const witness = utils.stringifyBigInts(await wtns.exportJson(`${dir}/witness.wtns`))
      fs.writeFileSync(`${dir}/witness.json`, JSON.stringify(witness, null, 2))

      out = await exec(
        `zkutil prove -c ${keyBasePath}.r1cs -p ${keyBasePath}.params -w ${dir}/witness.json -r ${dir}/proof.json -o ${dir}/public.json`,
      )
    } catch (e) {
      console.log(out, e)
      throw e
    }
    return '0x' + JSON.parse(fs.readFileSync(`${dir}/proof.json`)).proof
  })
}

module.exports = { prove }
