import BN from 'bn.js'
import chalk from 'chalk'

import { JsonRpcProvider, Web3Provider } from '@ethersproject/providers'

import { AbiCoder, Interface, JsonFragment } from '@ethersproject/abi'
import { TypedMessage } from '@metamask/eth-sig-util'
import { encode, List } from 'rlp'

import {
  Capability,
  FeeMarketEIP1559Transaction,
  Transaction,
  TransactionFactory,
  TxOptions,
  TypedTransaction
} from '@ethereumjs/tx'
import {
  bnToUnpaddedBuffer,
  bufferToHex,
  ecrecover,
  hashPersonalMessage,
  PrefixedHexString,
  pubToAddress,
  toBuffer,
  unpadBuffer
} from 'ethereumjs-util'

import { Address, EIP1559Fees, EventData, RelaySelectionResult } from './types/Aliases'

import { MessageTypes } from './EIP712/TypedRequestData'
import { fromWei, isBigNumber, toBN, toHex, toWei } from './web3js/Web3JSUtils'
import { ethers } from 'ethers'
import { keccak256 } from 'ethers/lib/utils'
import { RelayRequest } from './EIP712/RelayRequest'
import { PartialRelayInfo } from './types/RelayInfo'

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

export function padTo64 (hex: string): string {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

export function signatureRSV2Hex (r: BN | Buffer, s: BN | Buffer, v: number): string {
  return '0x' + padTo64(r.toString('hex')) + padTo64(s.toString('hex')) + v.toString(16).padStart(2, '0')
}

export function event2topic (contract: any, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.filters) { return names }
  return names
    .map(name => { return contract.filters[name]().topics[0] })
}

export function addresses2topics (addresses: string[]): string[] {
  return addresses.map(address2topic)
}

export function address2topic (address: string): string {
  return '0x' + '0'.repeat(24) + address.toLowerCase().slice(2)
}

// This conversion is needed since WS provider returns error as false instead of null/undefined in (error,result)
export function errorAsBoolean (err: any): boolean {
  return err as boolean
}

// extract revert reason from a revert bytes array.
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string | null {
  if (revertBytes == null) { return null }
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  return new AbiCoder().decode(['string'], '0x' + revertBytes.slice(10))[0]
}

export async function getDefaultMethodSuffix (provider: JsonRpcProvider): Promise<string> {
  const nodeInfo: string = await provider.send('web3_clientVersion', [])
  // ganache-cli
  if (nodeInfo.toLowerCase().includes('testrpc')) return ''
  // hardhat
  if (nodeInfo.toLowerCase().includes('hardhat')) return '_v4'
  // all other networks
  return '_v4'
}

export async function getEip712Signature<T extends MessageTypes> (
  provider: JsonRpcProvider,
  typedRequestData: TypedMessage<T>,
  methodSuffix: string | null = null,
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: TypedMessage<T> | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  methodSuffix = methodSuffix ?? await getDefaultMethodSuffix(provider)
  const paramBlock = {
    method: `eth_signTypedData${methodSuffix}`,
    params: [senderAddress, dataToSign],
    jsonrpc: '2.0',
    id: Date.now()
  }
  return await provider.send(paramBlock.method, paramBlock.params)
}

export function correctV (result: PrefixedHexString): PrefixedHexString {
  const buffer = toBuffer(result)
  const last = buffer.length - 1
  const oldV = buffer[last]
  if (oldV < 2) {
    buffer[last] += 27
    console.warn(`signature V adjusted from ${oldV} to ${buffer[last]}`)
  }
  return bufferToHex(buffer)
}

/**
 * @param calldata the hex string of data to be sent to the blockchain
 * @returns { calldataZeroBytes, calldataNonzeroBytes } - number of zero and nonzero bytes in the given calldata input
 */
export function calculateCalldataBytesZeroNonzero (
  calldata: PrefixedHexString
): { calldataZeroBytes: number, calldataNonzeroBytes: number } {
  const calldataBuf = Buffer.from(calldata.replace('0x', ''), 'hex')
  let calldataZeroBytes = 0
  let calldataNonzeroBytes = 0
  calldataBuf.forEach(ch => {
    ch === 0 ? calldataZeroBytes++ : calldataNonzeroBytes++
  })
  return { calldataZeroBytes, calldataNonzeroBytes }
}

export function getEcRecoverMeta (message: string, signature: string | Signature): PrefixedHexString {
  if (typeof signature === 'string') {
    const r = parseHexString(signature.substr(2, 65))
    const s = parseHexString(signature.substr(66, 65))
    const v = parseHexString(signature.substr(130, 2))
    signature = {
      v: v,
      r: r,
      s: s
    }
  }
  const bufSigned = hashPersonalMessage(Buffer.from(message))
  const recoveredPubKey = ecrecover(bufSigned, signature.v[0], Buffer.from(signature.r), Buffer.from(signature.s))
  return bufferToHex(pubToAddress(recoveredPubKey))
}

export function parseHexString (str: string): number[] {
  const result = []
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16))

    str = str.substring(2, str.length)
  }

  return result
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export async function sleep (ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function ether (n: string): BN {
  return new BN(toWei(n, 'ether'))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function eventsComparator (a: EventData, b: EventData): number {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex - a.transactionIndex
  }
  return b.blockNumber - a.blockNumber
}

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  return eventsComparator(a, b) > 0
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(eventsComparator)
  return eventDataSorted[0]
}

export interface PaymasterGasAndDataLimits {
  acceptanceBudget: BN
  preRelayedCallGasLimit: BN
  postRelayedCallGasLimit: BN
  calldataSizeLimit: BN
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

export function getDataAndSignature (tx: TypedTransaction, chainId: number): { data: string, signature: string } {
  if (tx.to == null) {
    throw new Error('tx.to must be defined')
  }
  if (tx.s == null || tx.r == null || tx.v == null) {
    throw new Error('tx signature must be defined')
  }
  const input: List = [bnToUnpaddedBuffer(tx.nonce)]
  if (!tx.supports(Capability.EIP1559FeeMarket)) {
    input.push(
      bnToUnpaddedBuffer((tx as Transaction).gasPrice)
    )
  } else {
    input.push(
      bnToUnpaddedBuffer((tx as FeeMarketEIP1559Transaction).maxPriorityFeePerGas),
      bnToUnpaddedBuffer((tx as FeeMarketEIP1559Transaction).maxFeePerGas)
    )
  }
  input.push(
    bnToUnpaddedBuffer(tx.gasLimit),
    tx.to.toBuffer(),
    bnToUnpaddedBuffer(tx.value),
    tx.data,
    toBuffer(chainId),
    unpadBuffer(toBuffer(0)),
    unpadBuffer(toBuffer(0))
  )
  let vInt = tx.v.toNumber()
  if (vInt > 28) {
    vInt -= chainId * 2 + 8
  }
  const data = `0x${encode(input).toString('hex')}`
  const signature = signatureRSV2Hex(tx.r, tx.s, vInt)
  return {
    data,
    signature
  }
}

export function signedTransactionToHash (signedTransaction: PrefixedHexString, transactionOptions: TxOptions): PrefixedHexString {
  return bufferToHex(TransactionFactory.fromSerializedData(toBuffer(signedTransaction), transactionOptions).hash())
}

/**
 * remove properties with null (or undefined) value
 * (does NOT handle inner arrays)
 * @param obj - object to clean
 * @param recursive - descend into inner objects
 */
export function removeNullValues<T> (obj: T, recursive = false): Partial<T> {
  const c: any = {}
  Object.assign(c, obj)

  for (const k of Object.keys(c)) {
    if (c[k] == null) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete c[k]
    } else if (recursive) {
      let val = c[k]
      if (typeof val === 'object' && !Array.isArray(val) && !BN.isBN(val)) {
        val = removeNullValues(val, recursive)
      }
      c[k] = val
    }
  }
  return c
}

export function formatTokenAmount (
  balance: BN,
  decimals: BN | number,
  tokenAddress: Address | undefined,
  tokenSymbol: string): string {
  let shiftedBalance: BN
  const tokenDecimals = toBN(decimals.toString())
  if (tokenDecimals.eqn(18)) {
    shiftedBalance = balance
  } else if (tokenDecimals.ltn(18)) {
    const shift = toBN(18).sub(tokenDecimals)
    shiftedBalance = balance.mul(toBN(10).pow(shift))
  } else {
    const shift = tokenDecimals.subn(18)
    shiftedBalance = balance.div(toBN(10).pow(shift))
  }
  let shortTokenAddress = ''
  if (tokenAddress != null) {
    shortTokenAddress = `(${tokenAddress.substring(0, 6)}...${tokenAddress.substring(39)})`
  }
  return `${fromWei(shiftedBalance)} ${tokenSymbol} ${shortTokenAddress}`
}

export function splitRelayUrlForRegistrar (url: string, partsCount: number = 3): string[] {
  const maxLength = 32 * partsCount
  if (url.length > maxLength) {
    throw new Error(`The URL does not fit to the RelayRegistrar. Please shorten it to less than ${maxLength} characters. The provided URL is: ${url}`)
  }
  const parts = url.match(/.{1,32}/g) ?? []
  const result: string[] = []
  for (let i = 0; i < partsCount; i++) {
    result.push(`0x${Buffer.from(parts[i] ?? '').toString('hex').padEnd(64, '0')}`)
  }
  return result
}

export function packRelayUrlForRegistrar (parts: string[]): string {
  return Buffer.from(
    parts.join('')
      .replace(/0x/g, '')
      .replace(/(00)+$/g, ''), 'hex').toString()
}

export function toNumber (numberish: number | string | BN | BigInt): number {
  switch (typeof numberish) {
    case 'string':
      return parseFloat(numberish)
    case 'number':
      return numberish
    case 'bigint':
      return Number(numberish)
    case 'object':
      if (isBigNumber(numberish)) {
        // @ts-ignore
        return numberish.toNumber()
      }
      throw new Error(`unsupported object of type ${numberish.constructor.name}`)
    default:
      throw new Error(`unsupported type ${typeof numberish}`)
  }
}

export function getRelayRequestID (relayRequest: RelayRequest, signature: PrefixedHexString): PrefixedHexString {
  const types = ['address', 'uint256', 'bytes']
  const parameters = [relayRequest.request.from, relayRequest.request.nonce, signature]
  const abiCoder = new ethers.utils.AbiCoder()
  const hash = keccak256(abiCoder.encode(types, parameters))
  const rawRelayRequestId = removeHexPrefix(hash).padStart(64, '0')
  const prefixSize = 8
  const prefixedRelayRequestId = rawRelayRequestId.replace(new RegExp(`^.{${prefixSize}}`), '0'.repeat(prefixSize))
  return `0x${prefixedRelayRequestId}`
}

export function getERC165InterfaceID (abi: JsonFragment[]): string {
  let interfaceId =
    abi
      .filter(it => it.type === 'function' && it.name != null)
      .map(it => {
        const iface = new Interface([it])
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return iface.getSighash(it.name!)
      })
      .filter(it => it !== '0x01ffc9a7') // remove the IERC165 method itself
      .map((x) => parseInt(x, 16))
      .reduce((x, y) => x ^ y)
  interfaceId = interfaceId > 0 ? interfaceId : 0xFFFFFFFF + interfaceId + 1
  return '0x' + interfaceId.toString(16).padStart(8, '0')
}

export function shuffle<T> (array: T[]): T[] {
  let currentIndex = array.length
  let randomIndex: number

  // While there remain elements to shuffle.
  while (currentIndex !== 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]]
  }

  return array
}

/**
 * @param results - all successfully resolved results in the order that they resolved.
 * @param errors - all rejection results
 */
export interface WaitForSuccessResults<T> {
  results: T[]
  errors: Map<string, Error>
}

/**
 * Wait for an array of promises.
 * After the first successful result, wait for "graceTime" period when the rest of the promises can still resolve.
 * Select a "winner" at random one of those successfully resolved promises.
 * @param promises - all promises we try to resolve
 * @param errorKeys - keys used to map errors to promises
 * @param graceTime - how long to wait after first successful result, in milliseconds
 * @param random  - Math.random-equivalent function (use for testing)
 * @returns - filled {@link WaitForSuccessResults} information
 */
export async function waitForSuccess<T> (
  promises: Array<Promise<T>>,
  errorKeys: string[],
  graceTime: number): Promise<WaitForSuccessResults<T>> {
  if (promises.length !== errorKeys.length) {
    throw new Error('Invalid errorKeys length')
  }
  for (let i = 0; i < errorKeys.length; i++) {
    const indexOfKey = errorKeys.indexOf(errorKeys[i])
    if (indexOfKey !== i) {
      throw new Error('waitForSuccess: duplicate relay URL keys, aborting')
    }
  }
  return await new Promise((resolve) => {
    const ret: WaitForSuccessResults<T> = {
      errors: new Map<string, Error>(),
      results: []
    }

    function complete (): void {
      resolve(ret)
    }

    for (let i = 0; i < promises.length; i++) {
      promises[i]
        .then(result => {
          ret.results.push(result)
          if (ret.results.length === 1) {
            setTimeout(complete, graceTime)
          }
        })
        .catch(err => {
          ret.errors.set(errorKeys[i], err)
        })
        .finally(() => {
          if (ret.results.length + ret.errors.size === promises.length) {
            complete()
          }
        })
    }
  })
}

export function pickRandomElementFromArray<T> (arrayIn: T[], random = Math.random): T {
  return arrayIn[Math.floor(random() * arrayIn.length)]
}

/**
 * @return newValue - the best value to use as a gas parameter:
 *          the one RelayProvider used if it is above RelayServer minimum, the minimum otherwise
 * @return deltaPercent - the difference between input and result, in percents
 */
export function adjustGasCostParameterUp (
  clientInput: number,
  pingResponseMinimum: number
): { newValue: number, deltaPercent: number } {
  if (clientInput >= pingResponseMinimum) {
    return { newValue: clientInput, deltaPercent: 0 }
  }
  const deltaPercent = Math.round(((pingResponseMinimum - clientInput) * 100) / clientInput)
  return { newValue: pingResponseMinimum, deltaPercent }
}

/**
 * The RelayServer may respond with a {@link PingResponse} with a response that will require adjusting some parameters.
 * @return - a {@link RelayRequest} with parameters that should satisfy the RelayServer,
 *           or null if the required gas fees are different more than the {@link gasPriceFactorPercent}.
 */
export function adjustRelayRequestForPingResponse (
  feesIn: EIP1559Fees,
  relayInfo: PartialRelayInfo
): RelaySelectionResult {
  const maxPriorityFeePerGas = adjustGasCostParameterUp(
    parseInt(feesIn.maxPriorityFeePerGas),
    parseInt(relayInfo.pingResponse.minMaxPriorityFeePerGas)
  )

  const maxFeePerGas = adjustGasCostParameterUp(
    parseInt(feesIn.maxFeePerGas),
    parseInt(relayInfo.pingResponse.minMaxFeePerGas)
  )

  const updatedGasFees: EIP1559Fees = {
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas.newValue),
    maxFeePerGas: toHex(maxFeePerGas.newValue)
  }
  const maxDeltaPercent = Math.max(maxFeePerGas.deltaPercent, maxPriorityFeePerGas.deltaPercent)
  return {
    relayInfo,
    maxDeltaPercent,
    updatedGasFees
  }
}

export function averageBN (array: BN[]): BN {
  const sum = array.reduce((a, v) => a.add(v))
  return sum.divn(array.length)
}

export function validateRelayUrl (relayUrl: string): boolean {
  let url
  try {
    url = new URL(relayUrl)
  } catch (error) {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

export function wrapWeb3JsProvider (provider: any): JsonRpcProvider {
  if (typeof provider === 'object' && typeof provider.getSigner !== 'function') {
    return new Web3Provider(provider)
  }
  return provider
}
