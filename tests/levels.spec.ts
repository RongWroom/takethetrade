import { expect, test } from '@playwright/test'

test('shares manual levels between Session Profile and Overview, including after reload', async ({ page }) => {
  await page.route('https://www.okx.com/**', route => route.fulfill({ json: { code: '0', data: [] } }))
  await page.routeWebSocket('wss://ws.okx.com/ws/v5/public', socket => {
    socket.onMessage(() => {
      socket.send(JSON.stringify({ event: 'subscribe' }))
      socket.send(JSON.stringify({ arg: { channel: 'trades' }, data: [
        { instId: 'BTC-USDT-SWAP', tradeId: 'levels-fixture', side: 'buy', sz: '100', ts: String(Date.now()), px: '80000' },
      ] }))
    })
  })
  await page.goto('/')
  await expect(page.getByText('$80,000.00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Footprint', exact: true }).click()
  await page.getByRole('tab', { name: /Session Profile/ }).click()
  const refs = page.getByRole('region', { name: 'Reference levels' })
  await refs.getByRole('button', { name: 'Add level' }).click()
  await refs.getByLabel('Price (USDT)').fill('80000')
  await refs.getByRole('combobox', { name: 'Period', exact: true }).selectOption('weekly')
  await refs.getByLabel('Note (optional)').fill('Marked on my chart')
  await refs.getByRole('button', { name: 'Save level' }).click()
  await expect(page.getByRole('region', { name: 'Session volume profile ladder' })
    .getByText('Weekly Level · Manual')).toBeVisible()

  await page.reload()
  await page.getByRole('tab', { name: 'Levels', exact: true }).click()
  await refs.getByText('Weekly Level · Manual').click()
  await expect(refs.getByText('Marked on my chart')).toBeVisible()
  await refs.getByRole('button', { name: 'Mark revisited' }).click()
  await expect(refs.getByText('Weekly Level · Manual')).toHaveCount(0)
  await refs.getByLabel('Show revisited').check()
  await refs.getByText('Weekly Level · Manual').click()
  await refs.getByRole('button', { name: 'Remove level' }).click()
  await expect(refs.getByText('Weekly Level · Manual')).toHaveCount(0)
})
