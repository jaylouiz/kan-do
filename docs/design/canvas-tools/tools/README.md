# Canvas-tool clients

The FigCraft and OpenPencil clients (`fc.py`, `op.py`) from the bake-off moved to the `ui-canvas` skill (its `scripts/` folder), where they are kept current. Only the Penpot client remains here, as bake-off evidence.

`pp.py`: an HTTP MCP client for self-hosted Penpot, Python 3 standard library only.
- **Usage:** `python3 -I pp.py [--timeout S] '<json array of {"name","arguments"}>'` (inline, or a file path).
- **Output:** per call, the raw and content reply sizes, the time and the status.
- **Extra call key:** `argfile_code` loads JS from a file into `arguments.code`.
- **Exit codes:** 0 ok, 1 tool or JSON-RPC error, 2 usage, 3 HTTP or connect error, 4 timeout.
- **Needs:**
  - Penpot reachable at `PENPOT_URL` (default `http://localhost:9001`);
  - a file open in a browser tab with the MCP plugin connected;
  - the key file named by `PENPOT_MCP_KEY_FILE` (required, no default). The script scrubs the key from every error message and never prints it.
