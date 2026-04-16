import asyncio
import websockets
import json
import base64
import os

key = os.environ.get("SARVAM_API_KEY", "b3ed39a8-e160-449e-b9b2-297ebceb53bd")

async def test_stream():
    url = "wss://api.sarvam.ai/speech-to-text-streaming/ws?model=saaras:v3&language-code=hi-IN&mode=transcribe&sample_rate=16000&input_audio_codec=raw"
    headers = {"Api-Subscription-Key": key}
    try:
        async with websockets.connect(url, additional_headers=headers) as ws:
            print("Connected with raw")
    except Exception as e:
        print("Failed raw:", e)

    url = "wss://api.sarvam.ai/speech-to-text-streaming/ws?model=saaras:v3&language-code=hi-IN&mode=transcribe&sample_rate=16000&input_audio_codec=wav"
    try:
        async with websockets.connect(url, additional_headers=headers) as ws:
            print("Connected with wav")
    except Exception as e:
        print("Failed wav:", e)

asyncio.run(test_stream())
