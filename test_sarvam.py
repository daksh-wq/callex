import asyncio
import websockets
import base64
import json
import wave
import sys
import os

key = os.environ.get("SARVAM_API_KEY", "")

async def test_fields(url, key):
    headers = {"Api-Subscription-Key": key}
    print("Testing:", url)
    try:
        async with websockets.connect(url, additional_headers=headers) as ws:
            print("Connected.")
            msg = {
                "audio": base64.b64encode(b'\x00' * 3200).decode('ascii'),
                "sample_rate": 16000,
                "encoding": "audio/wav"
            }
            await ws.send(json.dumps(msg))
            try:
                while True:
                    res = await asyncio.wait_for(ws.recv(), 4.0)
                    print("Response:", res)
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                print("Error:", e)
    except Exception as e:
        print("Connection failed:", e)

async def test_all():
    urls = [
        "wss://api.sarvam.ai/speech-to-text-streaming/ws?model=saaras:v3",
        "wss://api.sarvam.ai/v1/speech-to-text/ws?model=saaras:v3"
    ]
    for u in urls:
        await test_fields(u, key)

asyncio.run(test_all())
