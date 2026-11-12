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
  for (const label of ['Volume Delta', 'Cumulative Volume Delta', 'Open Interest', 'Liquidations']) {
    await page.getByRole('button', { name: `Open ${label} details` }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).click()
  }
  await page.getByRole('button', { name: /Market Pulse/ }).click()
  await expect(page.getByText(/Observed evidence/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByText('Cumulative Volume Delta').first().click()
  await expect(page.getByText('ExoCharts Median View')).toBeVisible()
  await expect(page.getByLabel('CVD median volume chart')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Price, Volume & Open Interest Matrix' })).toBeVisible()

  await page.getByRole('button', { name: '15m' }).click()
  await expect(page.getByText('15 minutes window', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '30m' }).click()
  await expect(page.getByText('30 minutes window', { exact: false })).toBeVisible()
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
  await expect(page.getByRole('button', { name: /Market Pulse \(5m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: /Balanced/ })).toBeChecked()
  await page.getByRole('radio', { name: /Slow/ }).check()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await expect(page.getByText('30 minutes window', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ttt.confirmation.v1'))).toBe('{"mode":"15m"}')
  await page.reload()
  await expect(page.getByRole('button', { name: /Market Pulse \(15m confirmation\)/ })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: /Slow/ })).toBeChecked()
})

test('bulk liquidation dismissal keeps card totals, flow alerts, and later liquidation alerts', async ({ page }) => {
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
  await expect(page.getByText('2 events in your inbox')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('$160.0K')).toBeVisible()

  await page.getByRole('button', { name: /Events/ }).click()
  await page.getByRole('button', { name: 'Dismiss liquidation history' }).click()
  await expect(page.getByText('Large long liquidation')).not.toBeVisible()
  await expect(page.getByText('Elevated taker buying delta')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('$160.0K')).toBeVisible()

  socket!.send(liquidationMessage(firstTs + 1))
  await expect(page.getByText('$320.0K')).toBeVisible()
  await page.getByRole('button', { name: /Events/ }).click()
  await expect(page.getByText('Large long liquidation')).toBeVisible()
  await expect(page.getByText('Elevated taker buying delta')).toBeVisible()
})

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
