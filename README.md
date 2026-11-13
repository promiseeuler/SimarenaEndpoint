# SimArena External Brain Endpoint

Connect any robot policy—local Python, ROS 2, a remote inference service, or a trained model—to a SimArena simulation through one small, versioned protocol.

Because SimArena does not currently publish a user API or API-key workflow, this repository also provides the beginning of a **companion runner**: export a scene from SimArena, validate/compile it outside the closed editor, and connect that runner to the brain endpoint.

SimArena sends observations to this service. The external brain receives them and returns actions. The endpoint validates messages, keeps the two peers isolated in a short-lived session, and relays traffic over WebSockets.

```text
SimArena (simulator)  ── observation ──▶  Endpoint  ──▶  External brain
SimArena (simulator)  ◀──── action ─────  Endpoint  ◀──  External brain
```

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

The API is then available at `http://localhost:3000`, interactive API documentation at `http://localhost:3000/docs`, and health status at `http://localhost:3000/health`.

Create a session:

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H 'content-type: application/json' \
  -d '{"name":"pick-and-place","metadata":{"robot":"SO-100"}}'
```

The response contains separate WebSocket URLs for the simulator and brain. Connect an external policy using the brain URL:

```bash
python3 examples/python_brain.py 'ws://localhost:3000/v1/sessions/SESSION_ID/connect?role=brain'
```

See [the integration guide](docs/integration-guide.md) for the full lifecycle, message schemas, ROS/policy adapter patterns, production security, and troubleshooting. See [the protocol reference](docs/protocol.md) for every wire message.

## Compile a SimArena export

In the SimArena editor choose **Export scene → Scene JSON**, then run:

```bash
npm run compile:scene -- ./scene.scene.json ./scene.xml
```

The command validates the observed `simarena/scene@1.0` format and converts supported primitive entities to MuJoCo MJCF. For robots, meshes, and complex assets, prefer SimArena’s native **MuJoCo MJCF .zip** export; the compiler reports rather than silently inventing unsupported mesh mappings.

The reusable [`SimulatorClient`](src/runner/simulator-client.ts) supplies the simulator side of the real-time loop, including observation/action correlation and action deadlines. A MuJoCo adapter can load the compiled/native MJCF, read physics state, call `observe()`, validate the returned command against actuator limits, and advance the engine.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness and supported protocol version |
| `POST` | `/v1/sessions` | Create a short-lived simulator/brain session |
| `GET` | `/v1/sessions/{id}` | Inspect connection state and expiry |
| `DELETE` | `/v1/sessions/{id}` | Close a session and both sockets |
| `WS` | `/v1/sessions/{id}/connect?role=brain\|simulator` | Join the real-time bridge |

When `SIMARENA_API_KEYS` is set, REST clients send `x-api-key` and WebSocket clients use `?apiKey=...`. Use TLS (`https`/`wss`) in production.

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Current scope

This repository provides the transport, public contract, scene importer/compiler, and simulator-side client. It does not yet embed MuJoCo or execute physics. The message model deliberately matches SimArena’s documented robot-learning workflow: robot joint state, extensible camera/depth/lidar/IMU sensor references, episode outcomes, and data that can remain compatible with LeRobot capture.

The MVP stores sessions in memory. A production multi-instance deployment should replace `SessionStore` with Redis (including pub/sub), terminate TLS at a trusted proxy, use per-tenant keys or OAuth, and move large image/point-cloud payloads to expiring object-storage URLs.

## License

No license has been selected yet. Add one before accepting external contributions or distributing the service.
