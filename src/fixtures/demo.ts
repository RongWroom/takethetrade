import type { CvdMedianProfile } from '../domain/tradeEngine'

export type Metric = {
  id: string
  label: string
  value: string
  description: string
  plainSummary?: string
  detail: string
  color: string
  bars: number[]
  cvdMedian?: CvdMedianProfile
}
export const metrics: Metric[] = [
 {id:'delta',label:'Volume Delta',value:'+248.6 BTC',description:'Buyers more aggressive',detail:'Aggressive buy volume exceeds aggressive sell volume in this example. Delta measures executed trades, not resting orders.',color:'teal',bars:[25,38,21,49,60,41,76,63,84,71,94,88]},
 {id:'cvd',label:'Cumulative Volume Delta',value:'+1,482 BTC',description:'Buying pressure increasing',detail:'Cumulative volume delta is the running sum of trade delta from a chosen session anchor. This example has no live session.',color:'blue',bars:[23,32,27,45,40,55,49,67,64,80,74,94]},
 {id:'oi',label:'Open Interest',value:'+2.4%',description:'Positioning expanding',detail:'Open interest represents outstanding positions. A rise alone does not reveal the direction of new positions.',color:'amber',bars:[23,26,32,31,44,39,51,60,57,75,79,88]},
 {id:'liquidations',label:'Liquidations',value:'$1.82M',description:'73% long liquidations',detail:'Reported forced closures may be incomplete or delayed. This illustration does not represent live exchange coverage.',color:'rose',bars:[14,21,37,23,56,31,76,49,35,84,54,70]},
]
