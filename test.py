"""
Entry point: test.py
This file exists so the server can continue running `python3 test.py`
or `uvicorn test:app` as before. It simply boots the modular Voice Engine
from the app/ package. All logic lives in app/main.py.
"""
from app.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8085, reload=False)
