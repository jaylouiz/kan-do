#!/usr/bin/env python3
"""Streamable-HTTP MCP client for self-hosted Penpot (localhost:9001).
Usage: python3 -I pp.py [--timeout SECS] '<json array>' | calls.json
Each call: {"name":..., "arguments":{...}, "png":"/optional/path.png", "argfile_code":"/path/to/code.js"}.
  argfile_code: reads JS from file into arguments.code (keeps large scripts out of the shell).
Key is read from the file named by $PENPOT_MCP_KEY_FILE (required) and never printed.
Env: PENPOT_URL (default http://localhost:9001); images go to $CANVAS_SHOTS_DIR (default ~/.cache/kan-do-canvas-shots).
Prints per call: bytes = raw reply body size (JSON or SSE), content = text size / decoded image size."""
import base64, json, os, sys, time, urllib.request, urllib.error

KEYF = os.environ.get("PENPOT_MCP_KEY_FILE")
SHOTS = os.environ.get("CANVAS_SHOTS_DIR") or os.path.expanduser("~/.cache/kan-do-canvas-shots")
if any(a in ("-h", "--help") for a in sys.argv[1:]) or len(sys.argv) < 2:
    print(__doc__); sys.exit(0)
if not KEYF:
    print("pp.py: set PENPOT_MCP_KEY_FILE to the Penpot MCP key file", file=sys.stderr); sys.exit(2)
KEY = open(KEYF).read().strip()
BASE = os.environ.get("PENPOT_URL", "http://localhost:9001")
URL = BASE + "/mcp/stream?userToken=" + KEY
TIMEOUT = 120.0

def scrub(s):
    return s.replace(KEY, "<key>")

def parse_body(body, ctype, rid):
    if "text/event-stream" in ctype:
        found = None
        for block in body.split("\n\n"):
            data = "".join(l[5:].lstrip() for l in block.splitlines() if l.startswith("data:"))
            if not data:
                continue
            try:
                m = json.loads(data)
            except ValueError:
                continue
            if isinstance(m, dict) and (rid is None or m.get("id") == rid):
                found = m
        return found
    return json.loads(body) if body.strip() else None

sid = None
def post(msg):
    global sid
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
         "MCP-Protocol-Version": "2025-06-18"}
    if sid:
        h["Mcp-Session-Id"] = sid
    req = urllib.request.Request(URL, json.dumps(msg).encode(), h, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        print(f"pp.py: HTTP {e.code}: {scrub(e.read().decode(errors='replace'))[:300]}", file=sys.stderr); sys.exit(3)
    except Exception as e:
        print(f"pp.py: {scrub(str(e))[:300]}", file=sys.stderr); sys.exit(3)
    s = r.headers.get("Mcp-Session-Id")
    if s: sid = s
    body = r.read().decode()
    return len(body.encode()), parse_body(body, r.headers.get("Content-Type", ""), msg.get("id"))

def close_session():
    if not sid: return
    try:
        req = urllib.request.Request(URL, method="DELETE", headers={"Mcp-Session-Id": sid, "MCP-Protocol-Version": "2025-06-18"})
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass  # server may not support DELETE (405); ignore

def main():
    global TIMEOUT
    a = sys.argv[1:]
    if a and a[0] == "--timeout":
        TIMEOUT = float(a[1]); a = a[2:]
    calls = json.load(open(a[0])) if os.path.isfile(a[0]) else json.loads(a[0])
    if isinstance(calls, dict): calls = [calls]
    post_n = 0
    _, init = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pp.py", "version": "1"}}})
    if not init or "result" not in init:
        print("pp.py: initialize failed", file=sys.stderr); sys.exit(3)
    post({"jsonrpc": "2.0", "method": "notifications/initialized"})
    rc = 0; stamp = time.strftime("%Y%m%d-%H%M%S")
    for i, c in enumerate(calls):
        args = dict(c.get("arguments", {}))
        if c.get("argfile_code"):
            args["code"] = open(c["argfile_code"]).read()
        t = time.time()
        n, r = post({"jsonrpc": "2.0", "id": 10 + i, "method": "tools/call", "params": {"name": c["name"], "arguments": args}})
        ms = (time.time() - t) * 1000
        out, cb, status = [], 0, "ok"
        if r is None or "error" in r:
            msg = scrub(json.dumps(r))[:2000]; out.append(msg); cb = len(msg); status = "jsonrpc-error"; rc = 1
        else:
            res = r.get("result") or {}
            if res.get("isError"): status = "tool-error"; rc = 1
            for part in res.get("content", []):
                if part.get("type") == "image":
                    png = c.get("png") or os.path.join((os.makedirs(SHOTS, exist_ok=True) or SHOTS), f"pp-{stamp}-{i}.png")
                    d = base64.b64decode(part["data"]); open(png, "wb").write(d)
                    cb += len(d); out.append(f"[image saved to {png}]")
                else:
                    txt = scrub(part.get("text", json.dumps(part))); cb += len(txt.encode()); out.append(txt)
            if not out: out.append(scrub(json.dumps(res)))
        print(f"--- {c['name']} | bytes={n} content={cb} | {ms:.0f} ms | {status}")
        print("\n".join(out))
    close_session()
    sys.exit(rc)
main()
