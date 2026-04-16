import urllib.request, json

API_KEY = "cd718a342035a5899d3716cfbfcb43cf7de2cad066d217aed8dbd768bd501d2a"

url = "https://api.elevenlabs.io/v1/voices"
headers = {"xi-api-key": API_KEY}
req = urllib.request.Request(url, headers=headers)

try:
    with urllib.request.urlopen(req) as response:
        voices = json.loads(response.read())['voices']
        for v in voices:
            name = v['name']
            accent = v.get('labels', {}).get('accent', '')
            desc = v.get('labels', {}).get('descriptive', '')
            use = v.get('labels', {}).get('use_case', '')
            lang = v.get('labels', {}).get('language', '')
            print(f"{name} | {v['voice_id']} | Accent: {accent} | Lang: {lang} | {desc}")
except Exception as e:
    print('Error:', e)
