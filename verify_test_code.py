import requests
import json

headers = {"Content-Type": "application/json"}
data = {
    "path": "auth:signIn",
    "args": {
        "provider": "resend-otp",
        "params": {"email": "harshitha@myos.test", "code": "843677"}
    },
    "format": "json"
}
try:
    r = requests.post("http://127.0.0.1:3210/api/action", headers=headers, json=data, timeout=5)
    print("Verify Status:", r.status_code)
    print("Verify Response:", r.text)
except Exception as e:
    print("Error:", e)
