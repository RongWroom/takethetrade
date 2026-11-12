import { expect, test, type Page } from '@playwright/test'

const B0 = Date.UTC(2025, 0, 6, 12, 0, 0)
const WINDOW_5M = 300_000
const START = B0 + 120_000

const priceAt = (t: number) => 80_000 + (100 * (t - B0)) / WINDOW_5M
const oiAt = (t: number) => 30_000 - (30 * (t - B0)) / WINDOW_5M

type Socket = { send: (message: string) => void; close: () => void }

test.beforeEach(async ({ page }) => {
  await page.route('https://www.okx.com/**', route => route.fulfill({ json: { code: '0', msg: '', data: [] } }))
})

async function openFakeClockFeed(page: Page): Promise<{ socket: () => Socket; now: { value: number } }> {
  let socket: Socket | undefined
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    socket = ws
    ws.onMessage(() => ws.send(JSON.stringify({ event: 'subscribe' })))
  })
  await page.clock.install({ time: START - 60_000 })
  await page.goto('/')
  await page.clock.pauseAt(START)
  return {
    socket: () => {
      if (!socket) throw new Error('WebSocket not connected')
      return socket
    },
    now: { value: START },
  }
}

async function feedUntil(page: Page, feed: { socket: () => Socket; now: { value: number } }, target: number) {
  while (feed.now.value < target) {
    const step = Math.min(10_000, target - feed.now.value)
    await page.clock.runFor(step)
    feed.now.value += step
    const t = feed.now.value
    feed.socket().send(JSON.stringify({ arg: { channel: 'open-interest' }, data: [{ instId: 'BTC-USDT-SWAP', oiCcy: oiAt(t).toFixed(4), ts: String(t) }] }))
    feed.socket().send(
      JSON.stringify({
        arg: { channel: 'trades' },
        data: [{ instId: 'BTC-USDT-SWAP', tradeId: `t-${t}`, side: 'buy', sz: '100', ts: String(t), px: priceAt(t).toFixed(1) }],
      }),
    )
    await page.waitForTimeout(100)
  }
}

test('confirms only after two full matching windows, keeps state across chart switches, and resets on mode change', async ({ page }) => {
  const feed = await openFakeClockFeed(page)
  await expect(page.getByText('Connected').first()).toBeVisible()

  await feedUntil(page, feed, B0 + 310_000)
  await expect(page.getByText(/(Warming up|Insufficient data) ·/)).toBeVisible()
  await expect(page.getByText(/Confirmed ·/)).not.toBeVisible()

  await feedUntil(page, feed, B0 + 610_000)
  await expect(page.getByText(/Pending · Candidate Weak uptrend: 1 of 2 matching 5m closes/)).toBeVisible()

  await feedUntil(page, feed, B0 + 910_000)
  await expect(page.getByText(/Confirmed · Weak uptrend: 2 of 2 matching 5m closes/)).toBeVisible()
  await expect(page.getByText('Weak uptrend · Bearish').first()).toBeVisible()
  await expect(page.getByText('CONFIRMED', { exact: true }).first()).toBeVisible()

  const capTime = feed.now.value
  feed.socket().send(
    JSON.stringify({
      arg: { channel: 'trades' },
      data: Array.from({ length: 50_001 }, (_, i) => ({ instId: 'BTC-USDT-SWAP', tradeId: `cap-${i}`, side: 'buy', sz: '1', ts: String(capTime), px: priceAt(capTime).toFixed(1) })),
    }),
  )
  await feedUntil(page, feed, capTime + 5_000)
  await expect(page.getByText(/Confirmed · Weak uptrend: 2 of 2 matching 5m closes/)).toBeVisible()

  await page.getByRole('button', { name: '15m', exact: true }).click()
  await expect(page.getByText(/Confirmed · Weak uptrend: 2 of 2 matching 5m closes/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Market Pulse \(5m confirmation\)/ })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: /Slow/ }).check()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText(/Warming up ·/)).toBeVisible()
  await expect(page.getByText(/Confirmed · Weak uptrend/)).not.toBeVisible()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
})

test('a closed connection invalidates an established confirmation', async ({ page }) => {
  const feed = await openFakeClockFeed(page)
  await expect(page.getByText('Connected').first()).toBeVisible()
  await feedUntil(page, feed, B0 + 910_000)
  await expect(page.getByText(/Confirmed · Weak uptrend: 2 of 2 matching 5m closes/)).toBeVisible()

  feed.socket().close()
  await expect(page.getByText(/Insufficient data ·/)).toBeVisible()
  await expect(page.getByText(/Confirmed · Weak uptrend/)).not.toBeVisible()
})

test('a hidden tab invalidates confirmation and returning visible does not restore it', async ({ page }) => {
  const feed = await openFakeClockFeed(page)
  await expect(page.getByText('Connected').first()).toBeVisible()
  await feedUntil(page, feed, B0 + 910_000)
  await expect(page.getByText(/Confirmed · Weak uptrend: 2 of 2 matching 5m closes/)).toBeVisible()

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText(/Insufficient data ·/)).toBeVisible()

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText(/Warming up ·/)).toBeVisible()
  await expect(page.getByText(/Confirmed ·/)).not.toBeVisible()
})
