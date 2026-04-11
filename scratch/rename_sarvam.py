import os
import re

directories = ['app']

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Save original to detect changes
    original = content

    # Temporarily hide the API URL so it doesn't get replaced
    content = content.replace('api.sarvam.ai', '@@@_API_URL_@@@')

    # Replace variations
    content = re.sub(r'SARVAM', 'SST_MODEL_2', content)
    content = re.sub(r'Sarvam', 'SSTModel2', content)
    content = re.sub(r'sarvam', 'sst_model_2', content)

    # Restore the API URL
    content = content.replace('@@@_API_URL_@@@', 'api.sarvam.ai')

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk('app'):
    # Ignore python cache
    if '__pycache__' in root:
        continue
    for file in files:
        if file.endswith('.py'):
            process_file(os.path.join(root, file))

