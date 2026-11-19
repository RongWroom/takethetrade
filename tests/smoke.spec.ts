import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://www.okx.com/**', route => route.fulfill({ json: { code: '0', msg: '', data: [] } }))
})

test('opens each metric and pulse evidence in the live-first layout', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
    })
  })
  await page.goto('/')
  await expect(page.getByText('Connected').first()).toBeVisible()

  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  for (const label of ['Volume Delta', 'Cumulative Volume Delta', 'Open Interest', 'Liquidations']) {
    await page.getByRole('button', { name: `Open ${label} details` }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).click()
  }

  await page.getByText('Cumulative Volume Delta').first().click()
  await expect(page.getByText('ExoCharts Median View')).toBeVisible()
  await expect(page.getByLabel('CVD median volume chart')).toBeVisible()

  await page.getByRole('button', { name: '15m' }).click()
  await expect(page.getByText('15 minutes window', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '30m' }).click()
  await expect(page.getByText('30 minutes window', { exact: false })).toBeVisible()

  await page.getByRole('tab', { name: /Pulse & OI Matrix/ }).click()
  await page.getByRole('button', { name: /Market Pulse/ }).click()
  await expect(page.getByText(/Observed evidence/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'Price, Volume & Open Interest Matrix' })).toBeVisible()

  await page.getByRole('button', { name: 'Cheat sheet (4 regimes) ↓' }).click()
  await expect(page.getByRole('button', { name: 'Hide reference table ↑' })).toBeVisible()
  const pulseBox = await page.locator('.pulse').boundingBox()
  const matrixBox = await page.locator('.oi-matrix-section').boundingBox()
  expect(pulseBox).not.toBeNull()
  expect(matrixBox).not.toBeNull()
  expect(pulseBox!.height).toBeLessThan(matrixBox!.height - 150)
})

test('focus mode and live event dismissal work', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'liquidation-orders' },
          data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '80000', posSide: 'long', side: 'sell', sz: '200', ts: String(Date.now()) }] }],
        }),
      )
    })
  })
  await page.goto('/')
  await expect(page.getByText('1 event in your inbox')).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Focus mode').check()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('View details →')).not.toBeVisible()
  await page.getByRole('button', { name: /Events/ }).click()
  await expect(page.getByText('Large long liquidation')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss event' }).click()
  await expect(page.getByText('All quiet here')).toBeVisible()
})

for (const width of [390, 768, 1024, 1440]) {
  test(`fits viewport at ${width}px`, async ({ page }) => {
    await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
      ws.onMessage(() => ws.send(JSON.stringify({ event: 'subscribe' })))
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Clarity in the flow.' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('displays normalized live trades, open interest and disconnect status', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 'test', side: 'buy', sz: '1', ts: String(Date.now()), px: '80000' }] }))
      ws.send(JSON.stringify({ arg: { channel: 'open-interest' }, data: [{ instId: 'BTC-USDT-SWAP', oiCcy: '30416.0481', ts: String(Date.now()) }] }))
      setTimeout(() => ws.close(), 1500)
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('+0.01 BTC').first()).toBeVisible()
  await expect(page.getByText('30,416.05 BTC')).toBeVisible()
  await expect(page.getByText('Incomplete coverage', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Disconnected', { exact: true }).first()).toBeVisible({ timeout: 10000 })
})

test('reconnects after an interruption and keeps the coverage warning', async ({ page }) => {
  let connections = 0
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      const connection = ++connections
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'trades' },
          data: [{ instId: 'BTC-USDT-SWAP', tradeId: `id-${connection}`, side: 'buy', sz: '1', ts: String(Date.now()), px: connection === 1 ? '80000' : '80001' }],
        }),
      )
      if (connection === 1) setTimeout(() => ws.close(), 1500)
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('$80,001.00')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('+0.02 BTC').last()).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Incomplete coverage', { exact: false }).first()).toBeVisible()
})

test('centers modal on desktop and positions as bottom sheet on mobile', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => ws.send(JSON.stringify({ event: 'subscribe' })))
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('tab', { name: /Pulse & OI Matrix/ }).click()
  await page.getByRole('button', { name: /Market Pulse/ }).click()
  const box = await page.getByRole('dialog').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThan(200)
  expect(box!.y).toBeGreaterThan(50)
})

test('My Trade drawer evaluates a long with entry, stop and leverage', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 't1', side: 'buy', sz: '100', ts: String(Date.now()), px: '80000' }] }))
      ws.send(JSON.stringify({ arg: { channel: 'funding-rate' }, data: [{ instId: 'BTC-USDT-SWAP', fundingRate: '0.0005', fundingTime: String(Date.now() + 3600000), ts: String(Date.now()) }] }))
    })
  })
  await page.goto('/')
  await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'My Trade' }).click()
  const drawer = page.getByRole('dialog', { name: 'My Trade' })
  await expect(drawer.getByText('This app cannot place trades')).toBeVisible()
  await expect(drawer.getByText('Thinking about a trade?')).toBeVisible()

  await drawer.getByRole('button', { name: /Long/ }).click()
  await expect(drawer.getByText('If you entered now')).toBeVisible()
  await expect(drawer.getByText(/Crowded trade/)).toBeVisible({ timeout: 10000 })

  await drawer.getByRole('button', { name: /Add entry/ }).click()
  await drawer.getByLabel(/Entry price/).fill('80,000')
  await drawer.getByLabel(/^Stop/).fill('81000')
  await expect(drawer.getByText('For a long, the stop should be below the entry price.')).toBeVisible()
  await drawer.getByLabel(/^Stop/).fill('79900')
  await drawer.getByLabel(/^Leverage/).fill('100')
  await expect(drawer.getByText('Your open trade')).toBeVisible()
  await expect(drawer.getByText(/force-closed around/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('button', { name: /My Trade/ })).toContainText('Long')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})


test('confirmation mode defaults to 5m, stays independent of the chart, and persists across reload', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => ws.send(JSON.stringify({ event: 'subscribe' })))
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /Pulse & OI Matrix/ }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(5m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: /Balanced/ })).toBeChecked()
  await page.getByRole('radio', { name: /Slow/ }).check()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  await expect(page.getByText('30 minutes window', { exact: false })).toBeVisible()
  await page.getByRole('tab', { name: /Pulse & OI Matrix/ }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ttt.confirmation.v1'))).toBe('{"mode":"15m"}')
  await page.reload()
  await page.getByRole('tab', { name: /Pulse & OI Matrix/ }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: /Slow/ })).toBeChecked()
})

test('clear market events removes both alert types while live totals stay and new events appear', async ({ page }) => {
  let socket: { send: (message: string) => void } | undefined
  let firstTs = 0
  const liquidationMessage = (ts: number) =>
    JSON.stringify({
      arg: { channel: 'liquidation-orders' },
      data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '80000', posSide: 'long', side: 'sell', sz: '200', ts: String(ts) }] }],
    })
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    socket = ws
    ws.onMessage(() => {
      firstTs = Date.now()
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 'big-buy', side: 'buy', sz: '2500', ts: String(firstTs), px: '80000' }] }))
      ws.send(liquidationMessage(firstTs))
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  await expect(page.getByText('2 events in your inbox')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('$160.0K')).toBeVisible()

  await page.getByRole('button', { name: /Events/ }).click()
  await page.getByRole('button', { name: 'Clear Market Events' }).click()
  await expect(page.getByText('All quiet here')).toBeVisible()
  await expect(page.getByText('No events to show. New market events will appear here.')).toBeVisible()
  await expect(page.getByText('Large long liquidation')).not.toBeVisible()
  await expect(page.getByText('Elevated taker buying delta')).not.toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('No events in your inbox')).toBeVisible()
  await expect(page.getByText('$160.0K')).toBeVisible()

  socket!.send(liquidationMessage(firstTs + 1))
  await expect(page.getByText('$320.0K')).toBeVisible()
  await expect(page.getByText('1 event in your inbox')).toBeVisible()
  await page.getByRole('button', { name: /Events/ }).click()
  await expect(page.getByText('Large long liquidation')).toBeVisible()
  await expect(page.getByText('Elevated taker buying delta')).not.toBeVisible()
})

test('flow-only market events can be cleared from the Events dialog', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 'big-sell', side: 'sell', sz: '2500', ts: String(Date.now()), px: '80000' }] }))
    })
  })
  await page.goto('/')
  await expect(page.getByText('1 event in your inbox')).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: /Events/ }).click()
  await expect(page.getByText('Elevated taker selling delta')).toBeVisible()
  await expect(page.getByText('Event history')).toBeVisible()
  await page.getByRole('button', { name: 'Clear Market Events' }).click()
  await expect(page.getByText('No events to show. New market events will appear here.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear Market Events' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('No events in your inbox')).toBeVisible()
})

for (const width of [320, 390, 768, 1280]) {
  test(`My Trade reset, direction and nav badge fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
      ws.onMessage(() => {
        ws.send(JSON.stringify({ event: 'subscribe' }))
        ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 't1', side: 'buy', sz: '100', ts: String(Date.now()), px: '80000' }] }))
      })
    })
    await page.goto('/')
    await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })
    await page.locator('.nav-trade').click()
    const drawer = page.getByRole('dialog', { name: 'My Trade' })
    await expect(drawer).toBeVisible()

    const reset = drawer.getByRole('button', { name: 'Reset My Trade' })
    const long = drawer.getByRole('button', { name: /Long/ })
    const short = drawer.getByRole('button', { name: /Short/ })
    const box = async (locator: typeof reset) => (await locator.boundingBox())!
    const expectInsideDrawer = async (locator: typeof reset) => {
      const b = await box(locator)
      const d = await box(drawer)
      expect(b.x).toBeGreaterThanOrEqual(d.x - 1)
      expect(b.x + b.width).toBeLessThanOrEqual(d.x + d.width + 1)
    }
    const expectToolbarClear = async () => {
      const r = await box(reset)
      const l = await box(long)
      const s = await box(short)
      expect(r.y + r.height + 8).toBeLessThanOrEqual(l.y)
      expect(l.x + l.width).toBeLessThanOrEqual(s.x + 1)
      for (const locator of [reset, long, short]) await expectInsideDrawer(locator)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    await expectToolbarClear()
    await long.click()
    await expect(drawer.getByText('Thinking about a trade?').or(drawer.getByText('If you entered now'))).toBeVisible()
    await expectToolbarClear()

    await page.keyboard.press('Escape')
    await expect(drawer).not.toBeVisible()
    const navButton = await box(page.locator('.nav-trade'))
    const badge = await box(page.locator('.nav-trade-side'))
    expect(badge.x).toBeGreaterThanOrEqual(navButton.x - 1)
    expect(badge.x + badge.width).toBeLessThanOrEqual(navButton.x + navButton.width + 1)
    expect(badge.y).toBeGreaterThanOrEqual(navButton.y - 1)
    expect(badge.y + badge.height).toBeLessThanOrEqual(navButton.y + navButton.height + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('Reset My Trade clears an invalid draft and persists the blank state on reload', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(JSON.stringify({ arg: { channel: 'trades' }, data: [{ instId: 'BTC-USDT-SWAP', tradeId: 't1', side: 'buy', sz: '100', ts: String(Date.now()), px: '80000' }] }))
    })
  })
  await page.goto('/')
  await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'My Trade' }).click()
  const drawer = page.getByRole('dialog', { name: 'My Trade' })
  await drawer.getByRole('button', { name: /Long/ }).click()
  await drawer.getByRole('button', { name: /Add entry/ }).click()
  await drawer.getByLabel(/Entry price/).fill('-5')
  await drawer.getByLabel(/^Stop/).fill('81000')
  await drawer.getByLabel(/^Leverage/).fill('abc')
  await expect(drawer.getByText('Entry price must be a positive number.')).toBeVisible()
  await expect(drawer.getByText(/For a long, the stop should be below the current price/)).toBeVisible()

  await drawer.getByRole('button', { name: 'Reset My Trade' }).click()
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText('Thinking about a trade?')).toBeVisible()
  await expect(drawer.getByRole('button', { name: /Long/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'My Trade', exact: true })).not.toContainText('Long')
  await drawer.getByRole('button', { name: /Short/ }).click()
  await drawer.getByRole('button', { name: /Add entry/ }).click()
  await expect(drawer.getByLabel(/Entry price/)).toHaveValue('')
  await expect(drawer.getByLabel(/^Stop/)).toHaveValue('')
  await expect(drawer.getByLabel(/^Leverage/)).toHaveValue('')
  await drawer.getByRole('button', { name: 'Reset My Trade' }).click()

  await page.reload()
  await page.getByRole('button', { name: 'My Trade' }).click()
  await expect(page.getByRole('dialog', { name: 'My Trade' }).getByText('Thinking about a trade?')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ttt.myTrade.v1'))).toBe('{"side":null,"entry":"","stop":"","leverage":""}')
})

test('Market Story visual displays chapter progression and flags order-flow divergence', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      const now = Date.now()
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'trades' },
          data: [
            { instId: 'BTC-USDT-SWAP', tradeId: 'div-1', side: 'buy', sz: '10', ts: String(now - 200), px: '80000' },
            { instId: 'BTC-USDT-SWAP', tradeId: 'div-2', side: 'sell', sz: '800', ts: String(now - 100), px: '80050' },
          ],
        }),
      )
    })
  })
  await page.goto('/')
  const storySection = page.getByRole('region', { name: 'Market Story visual' })
  await expect(storySection).toBeVisible()
  await expect(storySection.getByText(/Hollow rise · Divergence/).first()).toBeVisible({ timeout: 10000 })
  await expect(storySection.getByRole('status', { name: 'Order-flow divergence detected' })).toBeVisible()

  await storySection.getByRole('button', { name: 'How it works' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.getByText('Divergence', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'How it works' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('My Trade Snapshot & Journal logs page state, computes PnL on exit, and persists across reload', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'trades' },
          data: [{ instId: 'BTC-USDT-SWAP', tradeId: 'j-1', side: 'buy', sz: '200', ts: String(Date.now()), px: '80000' }],
        }),
      )
    })
  })
  await page.goto('/')
  await expect(page.getByText('$80,000.00')).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'My Trade' }).click()
  const drawer = page.getByRole('dialog', { name: 'My Trade' })
  await drawer.getByRole('button', { name: /Long/ }).click()
  await drawer.getByRole('button', { name: /Add entry/ }).click()
  await drawer.getByLabel(/Entry price/).fill('80000')
  await drawer.getByLabel(/^Leverage/).fill('10')

  await drawer.getByRole('button', { name: '+ Log Trade Snapshot' }).click()
  await expect(drawer.getByText(/Logged snapshot at/)).toBeVisible()
  await expect(drawer.getByText('▲ BUY / UP')).toBeVisible()

  await drawer.getByRole('button', { name: 'Win', exact: true }).click()
  await drawer.getByLabel('Exit price').fill('80800')
  await drawer.getByLabel('Trade note').fill('BOS breakout with positive delta')
  await expect(drawer.getByText('+1.00% (+10.0% @ 10x)')).toBeVisible()
  await expect(drawer.getByText(/100% win rate/)).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: /My Trade/ }).click()
  await expect(drawer.getByLabel('Trade note')).toHaveValue('BOS breakout with positive delta')
  await expect(drawer.getByText('+1.00% (+10.0% @ 10x)')).toBeVisible()
})

test('Footprint tab displays Section 1 battleground, POC, Value Zone, step grouping, Section 2 TSize, and fits mobile and desktop viewports', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      const now = Date.now()
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'trades' },
          data: [
            { instId: 'BTC-USDT-SWAP', tradeId: 'fp-1', side: 'buy', sz: '50', ts: String(now - 400), px: '80005' },
            { instId: 'BTC-USDT-SWAP', tradeId: 'fp-2', side: 'buy', sz: '140', ts: String(now - 300), px: '80025' },
            { instId: 'BTC-USDT-SWAP', tradeId: 'fp-3', side: 'sell', sz: '5', ts: String(now - 200), px: '80015' },
            { instId: 'BTC-USDT-SWAP', tradeId: 'fp-4', side: 'buy', sz: '90', ts: String(now - 100), px: '80026' },
          ],
        }),
      )
    })
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByText('$80,026.00')).toBeVisible({ timeout: 10000 })

  const footprintNav = page.getByRole('button', { name: 'Footprint', exact: true })
  await footprintNav.click()
  await expect(footprintNav).toHaveAttribute('aria-current', 'page')

  const ladderTab = page.getByRole('tab', { name: /Price Ladder \(POC\)/ })
  const tsizeTab = page.getByRole('tab', { name: /Whale vs\. Retail/ })
  await expect(ladderTab).toHaveAttribute('aria-selected', 'true')
  await expect(tsizeTab).toHaveAttribute('aria-selected', 'false')

  const fpSection = page.getByRole('region', { name: 'Footprint battleground' })
  await expect(fpSection).toBeVisible()
  await expect(fpSection.getByText('Point of Control (POC)')).toBeVisible()
  await expect(fpSection.getByText('Most traded price', { exact: true })).toBeVisible()
  await expect(fpSection.getByText('70% Value Zone')).toBeVisible()
  await expect(fpSection.getByText('Intrabar Delta Swing')).toBeVisible()
  await expect(fpSection.getByText('$80,025 USDT')).toBeVisible()

  const heightBefore = (await fpSection.boundingBox())!.height

  const ladder = fpSection.getByRole('region', { name: 'Footprint price ladder' })
  await expect(ladder.getByText('$80,025')).toBeVisible()
  await expect(ladder.getByText('$80,015')).toBeVisible()
  await expect(ladder.getByText('$80,005')).toBeVisible()

  await fpSection.getByRole('button', { name: '$10', exact: true }).click()
  await expect(fpSection.getByRole('button', { name: '$10', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(fpSection.getByText('$80,020 USDT')).toBeVisible()
  await expect(ladder.getByText('$80,020')).toBeVisible()
  await expect(ladder.getByText('$80,010')).toBeVisible()
  await expect(ladder.getByText('$80,000')).toBeVisible()
  const heightTen = (await fpSection.boundingBox())!.height
  expect(Math.abs(heightBefore - heightTen)).toBeLessThanOrEqual(2)

  await fpSection.getByRole('button', { name: '$25', exact: true }).click()
  await expect(fpSection.getByRole('button', { name: '$25', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(ladder.getByText('$80,025')).toBeVisible()
  await expect(ladder.getByText('$80,000')).toBeVisible()
  const heightTwentyFive = (await fpSection.boundingBox())!.height
  expect(Math.abs(heightBefore - heightTwentyFive)).toBeLessThanOrEqual(2)

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(fpSection).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await tsizeTab.click()
  await expect(tsizeTab).toHaveAttribute('aria-selected', 'true')
  await expect(fpSection).not.toBeVisible()

  const tsizeSection = page.getByRole('region', { name: 'Whale vs Retail flow' })
  await expect(tsizeSection).toBeVisible()
  await expect(tsizeSection.getByText('Whale Net Flow (≥ 1 ₿)', { exact: true })).toBeVisible()
  await expect(tsizeSection.getByText('Small Order Flow (< 0.1 ₿)', { exact: true })).toBeVisible()
  await expect(tsizeSection.getByText('Biggest Single Print', { exact: true })).toBeVisible()
  await expect(tsizeSection.getByText('BUY 1.40 ₿', { exact: true })).toBeVisible()
  await expect(tsizeSection.getByText('Whales are buying while small traders sell', { exact: true })).toBeVisible()

  const tiers = tsizeSection.getByRole('region', { name: 'Order size tiers' })
  await expect(tiers.getByText('Whales (≥ 1 ₿)', { exact: true })).toBeVisible()
  await expect(tiers.getByText('Small Orders (< 0.1 ₿)', { exact: true })).toBeVisible()

  await tsizeSection.getByRole('button', { name: 'Selected Candle', exact: true }).click()
  await expect(tsizeSection.getByRole('button', { name: 'Selected Candle', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await tsizeSection.getByRole('button', { name: '6-Bar Window', exact: true }).click()
  await expect(tsizeSection.getByRole('button', { name: '6-Bar Window', exact: true })).toHaveAttribute('aria-pressed', 'true')

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(tsizeSection).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  const svpTab = page.getByRole('tab', { name: /Session Profile \(SVP\)/ })
  await svpTab.click()
  await expect(svpTab).toHaveAttribute('aria-selected', 'true')
  await expect(tsizeSection).not.toBeVisible()

  const svpSection = page.getByRole('region', { name: 'Session volume profile', exact: true })
  await expect(svpSection).toBeVisible()
  await expect(svpSection.getByText('Session POC', { exact: true })).toBeVisible()
  await expect(svpSection.getByText('Session Value Area (70%)', { exact: true })).toBeVisible()
  await expect(svpSection.getByText('Naked POC Magnets', { exact: true })).toBeVisible()
  await expect(svpSection.getByText('$80,025 USDT', { exact: true })).toBeVisible()

  const svpLadder = svpSection.getByRole('region', { name: 'Session volume profile ladder', exact: true })
  await expect(svpLadder).toBeVisible()
  await expect(svpLadder.getByText('$80,025', { exact: true })).toBeVisible()
  await expect(svpLadder.getByText('$80,000', { exact: true })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(svpSection).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  const fpbsTab = page.getByRole('tab', { name: /Bar Stats \(FPBS\)/ })
  await fpbsTab.click()
  await expect(fpbsTab).toHaveAttribute('aria-selected', 'true')
  await expect(svpSection).not.toBeVisible()

  const fpbsSection = page.getByRole('region', { name: 'Footprint bar statistics', exact: true })
  await expect(fpbsSection).toBeVisible()
  await expect(fpbsSection.getByText('6-Bar Running CVD', { exact: true })).toBeVisible()
  await expect(fpbsSection.getByText('Intrabar Traps & Walls', { exact: true })).toBeVisible()
  await expect(fpbsSection.getByText('Peak Conviction Bar', { exact: true })).toBeVisible()
  await expect(fpbsSection.getByRole('button', { name: 'Export CSV ↓' })).toBeVisible()

  const fpbsMatrix = fpbsSection.getByRole('region', { name: 'FPBS stats matrix', exact: true })
  await expect(fpbsMatrix).toBeVisible()
  await expect(fpbsMatrix.getByRole('rowheader', { name: 'Volume' })).toBeVisible()
  await expect(fpbsMatrix.getByRole('rowheader', { name: 'Delta %' })).toBeVisible()
  await expect(fpbsMatrix.getByRole('rowheader', { name: 'Running CVD' })).toBeVisible()
  await expect(fpbsMatrix.getByRole('rowheader', { name: 'POC & Signal' })).toBeVisible()

  const pocRowCells = fpbsMatrix.locator('tbody tr').last().locator('td')
  await expect(pocRowCells).toHaveCount(6)
  const firstCellBox = (await pocRowCells.first().boundingBox())!
  const lastCellBox = (await pocRowCells.last().boundingBox())!
  expect(Math.abs(firstCellBox.y - lastCellBox.y)).toBeLessThanOrEqual(2)
  expect(lastCellBox.x).toBeGreaterThan(firstCellBox.x + 100)

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(fpbsSection).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('4h timeframe, multi-range SVP profiles, and Previous Day reference levels work across viewports', async ({ page }) => {
  const now = Date.now()
  const dayMs = 86_400_000
  const min15 = 900_000
  const hour1 = 3_600_000
  const hour4 = 14_400_000
  const todayUtcStart = Math.floor(now / dayMs) * dayMs
  const current15mStart = Math.floor(now / min15) * min15
  const current1hStart = Math.floor(now / hour1) * hour1
  const current4hStart = Math.floor(now / hour4) * hour4

  const makeRow = (ts: number, o: number, h: number, l: number, c: number, v: number) => [
    String(ts),
    String(o),
    String(h),
    String(l),
    String(c),
    String(v * 100),
    String(v),
  ]

  const candles15m = [
    makeRow(current15mStart, 63150, 63900, 63050, 63850, 40),
    ...(todayUtcStart < current15mStart
      ? [makeRow(todayUtcStart, 63600, 63880, 63550, 63820, 90)]
      : []),
    makeRow(todayUtcStart - min15, 61900, 62150, 61850, 62100, 140),
    makeRow(todayUtcStart - 4 * hour1, 62150, 62300, 62100, 62220, 120),
  ]
  const candles1h = [
    makeRow(current1hStart, 63600, 63900, 63550, 63850, 80),
    makeRow(todayUtcStart - 6 * hour1, 61950, 62250, 61900, 62150, 220),
    makeRow(todayUtcStart - 36 * hour1, 63020, 63200, 63000, 63150, 300),
    makeRow(todayUtcStart - 108 * hour1, 59900, 60300, 59800, 60100, 700),
  ]
  const candles4h = [
    makeRow(current4hStart - 2 * hour4, 62800, 63200, 62700, 63100, 180),
    makeRow(current4hStart - hour4, 63100, 63600, 63050, 63550, 210),
  ]

  await page.route('https://www.okx.com/api/v5/market/candles**', async route => {
    const url = new URL(route.request().url())
    const bar = url.searchParams.get('bar')
    const data =
      bar === '15m' ? candles15m : bar === '1H' ? candles1h : bar === '4H' ? candles4h : []
    await route.fulfill({ json: { code: '0', msg: '', data } })
  })

  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'trades' },
          data: [
            {
              instId: 'BTC-USDT-SWAP',
              tradeId: 'svp-live-1',
              side: 'buy',
              sz: '50',
              ts: String(Date.now() - 500),
              px: '63850',
            },
          ],
        }),
      )
    })
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByText('$63,850.00')).toBeVisible({ timeout: 10000 })

  // Switch top timeframe to 4h
  await page.getByRole('button', { name: '4h', exact: true }).click()
  await expect(page.getByRole('tab', { name: /Flow Metrics/ })).toBeVisible()
  await page.getByRole('tab', { name: /Flow Metrics/ }).click()
  await expect(page.getByText('4 hours window', { exact: false })).toBeVisible()

  // Navigate to Footprint -> SVP (defaults to Rolling 24h)
  await page.getByRole('button', { name: 'Footprint', exact: true }).click()
  await page.getByRole('tab', { name: /Session Profile \(SVP\)/ }).click()

  const svpSection = page.getByRole('region', { name: 'Session volume profile', exact: true })
  await expect(svpSection.getByRole('button', { name: '24h', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const vaCardValue = svpSection.locator('.fp-stat-card').nth(1).locator('.fp-stat-value')
  const pocCardValue = svpSection.locator('.fp-stat-card').nth(0).locator('.fp-stat-value')
  await expect(pocCardValue).not.toHaveText('—')

  // Previous Day Reference Strip visible with pVAL, pPOC, pVAH
  const prevDayStrip = svpSection.getByRole('region', { name: 'Previous day value area reference' })
  await expect(prevDayStrip).toBeVisible()
  await expect(prevDayStrip.getByText('pVAL (Prev Low)')).toBeVisible()
  await expect(prevDayStrip.getByText('pPOC (Prev Fair Value)')).toBeVisible()
  await expect(prevDayStrip.getByText('pVAH (Prev High)')).toBeVisible()
  await expect(prevDayStrip.getByText('Above pVAH')).toBeVisible()

  // Untested Daily nPOC Magnets strip lists both active daily nPOCs and reconciles on-ladder vs off-range
  const npocStrip = svpSection.getByRole('region', { name: 'Untested Naked POC magnets' })
  await expect(npocStrip).toBeVisible()
  await expect(npocStrip.getByText('2 active')).toBeVisible()
  await expect(npocStrip.getByText('On ladder')).toHaveCount(1)
  await expect(npocStrip.getByText('Below range')).toHaveCount(1)
  await expect(svpSection.getByText('1 on 24h ladder · 1 outside range')).toBeVisible()

  const va24h = await vaCardValue.innerText()

  // Widen to 7D brings both Daily nPOCs onto the ladder
  await npocStrip.getByRole('button', { name: /Widen to 7D/ }).click()
  await expect(svpSection.getByRole('button', { name: '7D', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(npocStrip.getByText('On ladder')).toHaveCount(2)
  await expect(svpSection.getByText('Daily session nPOCs · all on ladder')).toBeVisible()
  const va7d = await vaCardValue.innerText()

  await svpSection.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(svpSection.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const vaToday = await vaCardValue.innerText()

  await prevDayStrip.getByRole('button', { name: /Inspect Prev Day/ }).click()
  await expect(svpSection.getByRole('button', { name: 'Prev Day', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const vaPrevDay = await vaCardValue.innerText()

  await svpSection.getByRole('button', { name: 'Chart TF', exact: true }).click()
  await expect(svpSection.getByRole('button', { name: 'Chart TF', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(svpSection.getByText('SECTION 3 · SESSION VOLUME PROFILE (4H CHART)')).toBeVisible()

  expect(vaToday).not.toBe(vaPrevDay)
  expect(va7d).not.toBe(vaToday)
  expect(va24h).not.toBe(va7d)

  await svpSection.getByRole('button', { name: '24h', exact: true }).click()
  await expect(npocStrip).toBeVisible()

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(svpSection).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})


