import { useEffect, useState } from 'react'
import { normalizeOkxOpenInterest, normalizeOkxTrade } from '../data/okx'
import { replayTrades, type Trade } from '../domain/tradeEngine'

const minute = 60_000
const format = (n: bigint) => `${n < 0n ? '-' : '+'}${(n < 0n ? -n : n) / 100_000_000n}.${String((n < 0n ? -n : n) % 100_000_000n).padStart(8,'0')} BTC`
type View = { status: string; price: string | null; delta: bigint | null; cvd: bigint | null; anchor: number; updated: number | null; gap: boolean; oi: string | null; oiTime: number | null; oiStale: boolean }
export default function LiveOverview() {
 const [view,setView]=useState<View>(()=>({status:'Connecting',price:null,delta:null,cvd:null,anchor:Math.floor(Date.now()/minute)*minute,updated:null,gap:true,oi:null,oiTime:null,oiStale:true}))
 useEffect(()=>{
  let stopped=false, socket:WebSocket | undefined, timer:ReturnType<typeof setTimeout> | undefined, ping:ReturnType<typeof setInterval> | undefined, status='Connecting', lastReceive=0, lastEventTime=0, lastPrice:string|null=null, updated:number|null=null, gap=true, anchor=Math.floor(Date.now()/minute)*minute, trades:Trade[]=[], attempts=0, oi:string|null=null, oiTime:number|null=null
  const publish=()=>{
   const now=Date.now(); let delta:bigint|null=null,cvd:bigint|null=null
   if(trades.length){ try { const end=Math.max(anchor+minute,Math.floor(now/minute)*minute+minute); const b=replayTrades(trades,{exchange:'OKX',symbol:'BTC-USDT-SWAP',start:anchor,end,bucketMs:minute}).buckets; delta=b[b.length-1].delta;cvd=b[b.length-1].cvd } catch { status='Data error'; gap=true; trades=[] } }
   setView({status:status==='Connected' && updated !== null && now-updated>15000?'Stale':status,price:lastPrice,delta,cvd,anchor,updated,gap,oi,oiTime,oiStale:status!=='Connected' || oiTime===null || now-oiTime>15000})
  }
  const connect=()=>{
   if(stopped)return
   status=attempts?'Reconnecting':'Connecting';publish()
   socket=new WebSocket('wss://ws.okx.com/ws/v5/public')
   socket.onopen=()=>{ if(!socket || stopped)return; lastReceive=Date.now();socket.send(JSON.stringify({op:'subscribe',args:[{channel:'trades',instId:'BTC-USDT-SWAP'},{channel:'open-interest',instId:'BTC-USDT-SWAP'}]})) }
   socket.onmessage=e=>{
    lastReceive=Date.now();if(e.data==='pong')return
    try { const msg=JSON.parse(String(e.data)); if(msg.event==='error'){gap=true;status='Subscription error';socket?.close();return} if(msg.event==='subscribe'){attempts=0;status='Connected';publish();return} if(!Array.isArray(msg.data))return; if(msg.arg?.channel==='open-interest'){for(const row of msg.data){const sample=normalizeOkxOpenInterest(row);if(sample.time <= Date.now()+60000 && (oiTime === null || sample.time >= oiTime)){oi=sample.btc;oiTime=sample.time}} return} if(msg.arg?.channel!=='trades')return
     for(const row of msg.data){ const t=normalizeOkxTrade(row); if(t.time > Date.now()+60000){gap=true;continue} if(t.time>=anchor){trades.push(t);if(t.time>=lastEventTime){lastEventTime=t.time;lastPrice=t.price;updated=t.time}} }
     if(trades.length>50000){trades=trades.slice(-50000);gap=true;anchor=Math.floor(trades[0].time/minute)*minute;trades=trades.filter(t=>t.time>=anchor)}
    } catch {gap=true}
   }
   socket.onerror=()=>socket?.close()
   socket.onclose=()=>{if(stopped)return;gap=true;status='Disconnected';publish();attempts++;timer=setTimeout(connect,Math.min(1000*2**Math.min(attempts,5),30000))}
  }
  const onVisibilityChange=()=>{ if(document.visibilityState==='hidden'){gap=true} else if(socket?.readyState===WebSocket.OPEN && Date.now()-lastReceive>30000){gap=true;socket.close()} }
  document.addEventListener('visibilitychange',onVisibilityChange)
  connect();const render=setInterval(publish,5000);ping=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN && Date.now()-lastReceive>20000) socket.send('ping'); if(socket?.readyState===WebSocket.OPEN && Date.now()-lastReceive>30000){gap=true;socket.close()}},5000)
  return()=>{stopped=true;document.removeEventListener('visibilitychange',onVisibilityChange);clearInterval(render);if(ping)clearInterval(ping);if(timer)clearTimeout(timer);socket?.close()}
 },[])
 return <section aria-label="Live market data"><div className="section-heading"><div><p className="eyebrow">OKX · BTC-USDT-SWAP</p><h2>Live trade data</h2></div><span className="muted">{view.status}</span></div><div className="detail-box" role="status"><strong>{view.status}</strong><p>Session begins {new Date(view.anchor).toISOString()} · {view.gap?'Incomplete coverage: no backfill and gaps may exist.':'Coverage available'}</p><p>{view.updated ? `Last trade ${new Date(view.updated).toISOString()}` : 'Waiting for trade data.'} Browser sleep and network interruptions can cause gaps.</p></div><div className="grid live-grid"><div className="metric blue"><span className="card-head">Last trade price</span><strong>{view.price ? `$${view.price}` : '—'}</strong><span className="card-foot">OKX · last received trade</span></div><div className="metric teal"><span className="card-head">Volume delta · current UTC minute</span><strong>{view.delta===null?'—':format(view.delta)}</strong><span className="card-foot">Buy minus sell · incomplete coverage</span></div><div className="metric blue"><span className="card-head">Session CVD</span><strong>{view.cvd===null?'—':format(view.cvd)}</strong><span className="card-foot">Since session start · incomplete coverage</span></div><div className="metric amber"><span className="card-head">Open interest</span><strong>{view.oi===null?'—':`${view.oi} BTC`}</strong><span className="card-foot">{view.oiTime===null?'Waiting for OKX':`OKX · ${new Date(view.oiTime).toISOString()}${view.oiStale ? ' · stale' : ''}`}</span></div></div><div className="note"><div><strong>Other metrics unavailable</strong><p>Liquidations and Market Pulse are not connected in live mode. No demo values are shown here.</p></div></div></section>
}
