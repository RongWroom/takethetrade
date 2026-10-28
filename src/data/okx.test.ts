import { describe, expect, it } from 'vitest'
import { normalizeOkxOpenInterest, normalizeOkxTrade } from './okx'
const trade = {instId:'BTC-USDT-SWAP',tradeId:'123',side:'buy',sz:'0.61',ts:'1793220086598',px:'81069.9'}
describe('OKX trades',()=>{
 it('converts swap contracts to BTC exactly',()=>{expect(normalizeOkxTrade(trade)).toMatchObject({quantityBtc:'0.00610000',side:'buy',id:'123',time:1793220086598})})
 it('rejects malformed and unrelated data',()=>{for(const value of [{...trade,sz:'0.0000001'},{...trade,side:'unknown'},{...trade,instId:'OTHER'},{...trade,px:'0'}]) expect(()=>normalizeOkxTrade(value)).toThrow()})
})

describe('OKX open interest', () => {
 it('preserves BTC units and timestamp', () => { expect(normalizeOkxOpenInterest({instId:'BTC-USDT-SWAP',oiCcy:'30416.048100000105',ts:'1793220083984'})).toEqual({btc:'30416.048100000105',time:1793220083984}) })
 it('rejects malformed samples', () => { expect(() => normalizeOkxOpenInterest({instId:'BTC-USDT-SWAP',oiCcy:'NaN',ts:'0'})).toThrow() })
})
