import { expect, test } from '@playwright/test'

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
})

test('focus mode and live event dismissal work', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({ event: 'subscribe' }))
      ws.send(
        JSON.stringify({
          arg: { channel: 'liquidation-orders' },
          data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '80000', posSide: 'long', side: 'sell', sz: '100', ts: String(Date.now()) }] }],
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

