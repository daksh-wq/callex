import asyncio
import httpx
import os
import io

SARVAM_API_KEY = "sk_bm79tc59_upqYb40cw1XeEaEFmwtJNmJB"

async def test():
    # Record a quick empty wav or use a dummy
    dummy_wav = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
    async with httpx.AsyncClient() as client:
        url = "https://api.sarvam.ai/speech-to-text"
        headers = {"api-subscription-key": SARVAM_API_KEY}
        files = {"file": ("audio.wav", io.BytesIO(dummy_wav), "audio/wav")}
        data = {"model": "saaras:v3", "language_code": "unknown", "mode": "transcribe"}
        r = await client.post(url, files=files, data=data, headers=headers)
        print(r.json())

asyncio.run(test())
