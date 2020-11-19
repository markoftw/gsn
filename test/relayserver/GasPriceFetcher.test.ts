import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { configureGSN } from '../../src/relayclient/GSNConfigurator'
import { LoggerInterface } from '../../src/common/LoggerInterface'
import express from 'express'
import { Server } from 'net'
import { GasPriceFetcher } from '../../src/relayclient/GasPriceFetcher'

const { expect } = chai.use(chaiAsPromised)

context('GasPriceFetcher', function () {
  let errorlog: string
  let gasPriceFetcher: GasPriceFetcher
  let contractInteractor: ContractInteractor

  const logger = {
    error: (e: string) => {
      errorlog = errorlog + '\n' + e
    }
  } as any as LoggerInterface

  let oracleUrl: string
  let mockOracleResponse: string
  let server: Server

  const etherscanOracleResponse = '{"status":"1","message":"OK-Missing/Invalid API Key, rate limit of 1/5sec applied","result":{"LastBlock":"11236652","SafeGasPrice":"18","ProposeGasPrice":"39","FastGasPrice":"54"}}'

  before(async () => {
    contractInteractor = new ContractInteractor(web3.currentProvider as any, logger, configureGSN({}))

    const mockServer = express()
    mockServer.get('/geturl', async (req, res) => {
      res.send(mockOracleResponse)
    })
    await new Promise((resolve) => {
      server = mockServer.listen(0, resolve)
    })
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    oracleUrl = `http://localhost:${(server as any).address().port}/geturl`
  })

  after(() => {
    server?.close()
  })

  describe('#getJsonElement', () => {
    let gasPriceFetcher: GasPriceFetcher
    const blob = {
      abc: [
        { def: { ghi: 'hello' } }
      ]
    }

    before(() => {
      gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)
    })

    it('should return value for good path', () => {
      assert.equal(gasPriceFetcher.getJsonElement(blob, '.abc[0]["def"].ghi'), 'hello')
    })

    it('should return null for wrong path', () => {
      assert.isNull(gasPriceFetcher.getJsonElement(blob, '.abc[0]["invalid"].ghi'))
      assert.isNull(gasPriceFetcher.getJsonElement(blob, '.missing'))
    })

    it('should throw on malformed path', () => {
      expect(() => gasPriceFetcher.getJsonElement(blob, 'abc.def')).to.throw('invalid path: abc.def')
      expect(() => gasPriceFetcher.getJsonElement(blob, '.abc[noquote]')).to.throw('invalid path: .abc[noquote]')
    })
  })

  it('should use gasPriceOracle if provided', async () => {
    gasPriceFetcher = new GasPriceFetcher(oracleUrl, '.result.ProposeGasPrice', contractInteractor, logger)
    mockOracleResponse = etherscanOracleResponse
    assert.equal(
      await gasPriceFetcher.getGasPrice(),
      (JSON.parse(etherscanOracleResponse).result.ProposeGasPrice * 1e9).toString())
  })
  it('should use getGasPrice() if path not found', async () => {
    gasPriceFetcher = new GasPriceFetcher(oracleUrl, '.result.wrongpath', contractInteractor, logger)

    errorlog = ''
    assert.equal(
      await gasPriceFetcher.getGasPrice(),
      await web3.eth.getGasPrice())
    assert.match(errorlog, /not a number/)
  })
  it('should use getGasPrice() if return is not json', async () => {
    gasPriceFetcher = new GasPriceFetcher(oracleUrl, '.result.ProposeGasPrice', contractInteractor, logger)
    mockOracleResponse = 'something that is not json response'
    errorlog = ''
    assert.equal(
      await gasPriceFetcher.getGasPrice(),
      await web3.eth.getGasPrice())

    assert.match(errorlog, /not a number/)
  })
  it('should use getGasPrice() if failed  to connect oracle', async () => {
    gasPriceFetcher = new GasPriceFetcher('http://localhost:23456', '.result.ProposeGasPrice', contractInteractor, logger)
    errorlog = ''
    assert.equal(
      await gasPriceFetcher.getGasPrice(),
      await web3.eth.getGasPrice())
    assert.match(errorlog, /ECONNREFUSED/)
  })
})