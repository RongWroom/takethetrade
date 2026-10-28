"""Public, bounded OKX feed diagnostic. Requires Python websockets >= 15."""
import asyncio
import json
import time
import websockets

URL = 'wss://ws.okx.com/ws/v5/public'
TOPICS = [
    {'channel': 'trades', 'instId': 'BTC-USDT-SWAP'},
    {'channel': 'open-interest', 'instId': 'BTC-USDT-SWAP'},
    {'channel': 'liquidation-orders', 'instType': 'SWAP'},
]

async def observe(round_number):
    counts = {topic['channel']: 0 for topic in TOPICS}
    async with websockets.connect(URL, open_timeout=15) as socket:
        print(f'Connection {round_number}: connected', flush=True)
        await socket.send(json.dumps({'op': 'subscribe', 'args': TOPICS}))
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            try:
                message = json.loads(await asyncio.wait_for(socket.recv(), deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            if message.get('event'):
                print('Event:', message.get('event'), message.get('arg', {}), message.get('msg', ''), flush=True)
            channel = message.get('arg', {}).get('channel')
            if 'data' in message and channel in counts:
                counts[channel] += len(message['data'])
                if counts[channel] == len(message['data']):
                    print('First sample:', channel, json.dumps(message['data'][0]), flush=True)
        print('Message data counts:', json.dumps(counts), flush=True)

async def main():
    for attempt in (1, 2):
        await observe(attempt)

if __name__ == '__main__':
    asyncio.run(main())
