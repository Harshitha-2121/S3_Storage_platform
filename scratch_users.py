import sqlite3
import json

conn = sqlite3.connect("/tmp/convex.sqlite3")
c = conn.cursor()
print("--- ALL DOCS ---")
for (row,) in c.execute("SELECT json_value FROM documents WHERE deleted=0").fetchall():
    try:
        d = json.loads(row)
        if any(k in d for k in ["code", "token", "attemptsLeft", "authVerificationCodes", "authSessions", "workspaces", "users"]):
            print(json.dumps(d))
    except:
        pass
