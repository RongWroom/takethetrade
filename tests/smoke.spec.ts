import { expect, test } from '@playwright/test'

test('opens each metric and pulse evidence', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Demo mode')).toBeVisible()
  for (const label of ['Volume Delta', 'Cumulative Volume Delta', 'Open Interest', 'Liquidations']) {
    await page.getByRole('button', { name: `Open ${label} details` }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: label, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).click()
  }
  await page.getByRole('button', { name: /Market Pulse/ }).click()
  await expect(page.getByText('Example evidence')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('focus mode and event dismissal work', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Focus mode').check()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('Buyers more aggressive')).not.toBeVisible()
  await page.getByRole('button', { name: /Events/ }).click()
  await page.getByRole('button', { name: 'Dismiss event' }).click()
  await expect(page.getByText('All quiet here')).toBeVisible()
})

for (const width of [390, 768, 1024, 1440]) {
  test(`fits viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Clarity in the flow.' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('previews loading and error states without demo values', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Preview data state').selectOption('loading')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('Loading example data')).toBeVisible()
  await expect(page.getByText('+248.6 BTC')).not.toBeVisible()
  await page.getByRole('button', { name: 'Return to demo data' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel('Preview data state').selectOption('error')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('Example data unavailable')).toBeVisible()
})

test('live mode displays normalized trades and disconnect status without demo values', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      ws.send(JSON.stringify({event:'subscribe'}))
      ws.send(JSON.stringify({arg:{channel:'trades'},data:[{instId:'BTC-USDT-SWAP',tradeId:'test',side:'buy',sz:'1',ts:String(Date.now()),px:'80000'}]}))
      setTimeout(() => ws.close(), 6500)
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Try live data' }).click()
  await expect(page.getByText('$80000')).toBeVisible({timeout:10000})
  await expect(page.getByText('+0.01000000 BTC').first()).toBeVisible()
  await expect(page.getByText('Incomplete coverage', {exact:false}).first()).toBeVisible()
  await expect(page.getByText('Buying pressure is building')).not.toBeVisible()
  await expect(page.getByText('Disconnected', {exact:true}).first()).toBeVisible({timeout:12000})
  await page.getByRole('button', { name: 'Switch to demo' }).click()
  await expect(page.getByText('Demo mode')).toBeVisible()
})

test('reconnects after an interruption and keeps the coverage warning', async ({ page }) => {
  let connections = 0
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => {
    ws.onMessage(() => {
      const connection = ++connections
      ws.send(JSON.stringify({event:'subscribe'}))
      ws.send(JSON.stringify({arg:{channel:'trades'},data:[{instId:'BTC-USDT-SWAP',tradeId:`id-${connection}`,side:'buy',sz:'1',ts:String(Date.now()),px:connection === 1 ? '80000' : '80001'}]}))
      if (connection === 1) setTimeout(() => ws.close(), 6000)
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Try live data' }).click()
  await expect(page.getByText('$80000')).toBeVisible({timeout:10000})
  await expect(page.getByText('$80001')).toBeVisible({timeout:18000})
  await expect(page.getByText('+0.02000000 BTC').last()).toBeVisible()
  await expect(page.getByText('Incomplete coverage', {exact:false}).first()).toBeVisible()
})

test('displays validated live open interest separately from trade data', async ({ page }) => {
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', ws => ws.onMessage(() => {
    ws.send(JSON.stringify({event:'subscribe'}))
    ws.send(JSON.stringify({arg:{channel:'open-interest'},data:[{instId:'BTC-USDT-SWAP',oiCcy:'30416.0481',ts:String(Date.now())}]}))
  }))
  await page.goto('/')
  await page.getByRole('button', {name:'Try live data'}).click()
  await expect(page.getByText('30416.0481 BTC')).toBeVisible({timeout:10000})
  await expect(page.getByText('Liquidations and Market Pulse are not connected', {exact:false})).toBeVisible()
})
