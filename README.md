# HRA Local Development

## Start The Full Stack (Console)

Use the root helper script:

```bash
./start.sh
```

This runs `npm run dev` and starts:

- client (`packages/client`)
- server (`packages/server`)
- sandbox (`packages/sandbox`)

You should see prefixed logs in the same terminal:

- `[client]` Vite startup and URL (typically `http://localhost:5173/`)
- `[server]` websocket/tick logs
- `[sandbox]` sandbox heartbeat logs

## Verify Server Connect/Disconnect Logs

Current browser client is still local-only (no websocket connect yet), so opening the page alone will not show server "connected" logs.

Use this temporary smoke client in another terminal while stack is running:

```bash
node -e 'const ws=new WebSocket("ws://127.0.0.1:2567");ws.onmessage=(e)=>{console.log(e.data);setTimeout(()=>ws.close(),1000);};'
```

Expected server logs:

- `connected playerId=...`
- `disconnected playerId=...`
