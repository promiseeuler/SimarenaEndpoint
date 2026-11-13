# External brain integration guide

## What this service does

The endpoint is a rendezvous and validation layer between one running SimArena simulation and one external controller. It does not run physics or a model. This separation lets engineers keep their existing inference stack while using SimArena for scenes, sensors, execution, evaluation, and data collection.

Each session has exactly two roles:

- `simulator`: the SimArena runtime. It publishes observations and episode results, and applies actions.
- `brain`: the engineer’s controller or policy. It consumes observations and publishes actions or reset requests.

Messages are UTF-8 JSON. Large camera frames, depth maps, and point clouds should be stored separately and represented in `observation.sensors` by short-lived HTTPS URLs plus their media type, shape, and encoding.

## Integration when the SimArena runtime is unavailable

SimArena currently exposes scene export in its editor but does not publicly document user API keys or an external-controller API. The supported fallback in this repository is therefore an export-driven companion runner:

1. Build the scene in SimArena.
2. Export `Scene JSON .scene.json` for inspection/conversion, or `MuJoCo MJCF .zip` when the scene contains robots and mesh assets.
3. Validate a JSON export with the `simarena/scene@1.0` importer.
4. Compile supported primitive geometry with `npm run compile:scene -- input.scene.json output.xml`.
5. Load the resulting or native MJCF in a MuJoCo engine adapter.
6. Use `SimulatorClient` to connect that adapter to the external brain endpoint.

This avoids browser injection and undocumented application internals. The current compiler supports primitive plane, box, sphere, cylinder, and capsule geometry. It intentionally warns and skips mesh geometry because a correct conversion also needs the exported asset files. Lights are rendering concerns and are not emitted into the physics model.

## End-to-end lifecycle

1. A trusted backend creates a session with `POST /v1/sessions`.
2. The backend passes the simulator URL to SimArena and the brain URL to the engineer’s controller. Treat both URLs as credentials when they contain an API key.
3. Each side opens its WebSocket. The service emits `connected`, then notifies the existing side with `peer_status`.
4. Both sides send `hello` to declare their implementation and capabilities.
5. The simulator sends an `observation` for step N.
6. The brain replies with an `action` carrying the same `episodeId` and `stepId`.
7. The simulator applies the action, advances physics, and sends the next observation.
8. The simulator sends `episode_result` when its success hook, failure condition, time limit, or cancellation ends the episode.
9. Either side disconnects. The owner should close the session with `DELETE /v1/sessions/{id}` when it will not be reused.

The controller should enforce its own inference deadline. A safe default is to return a stop/hold action if inference exceeds the simulator’s configured control period.

## Connect a Python policy

Install the one example dependency:

```bash
python3 -m pip install websockets
python3 examples/python_brain.py 'ws://localhost:3000/v1/sessions/SESSION_ID/connect?role=brain'
```

Replace `choose_action()` in the example with a call to your model. Preserve `episodeId` and `stepId`; they are the correlation key that prevents a late action from being applied to the wrong simulation step.

For a LeRobot policy, convert `observation.jointPositions` and sensor entries to the feature names and tensor shapes in the policy configuration, run inference without gradients, then convert the result back to the action mode configured in the SimArena robot. Do not assume joint order: agree on it in session metadata or a future robot manifest capability.

## Connect SimArena

The editor/runtime adapter should:

1. Join with `role=simulator` and send `hello`.
2. Read the active robot’s ordered joint list and configured sensors.
3. On every control tick, serialize the current state into `observation`.
4. Wait up to the configured action deadline.
5. Verify that the received `episodeId` and `stepId` equal the current tick.
6. Clamp positions, velocities, torques, and gripper commands to the robot model’s limits.
7. Apply the command through the selected engine (for example MuJoCo WASM, Rapier, or PhysX).
8. Record the observation/action pair in the active episode so existing LeRobot export remains possible.
9. Evaluate the scene’s success/failure hooks and publish `episode_result`.

The simulator is the final safety authority. It must reject stale, non-finite, incorrectly sized, or out-of-limit actions even though the bridge also validates the JSON shape.

## Authentication and deployment

For local development, an empty `SIMARENA_API_KEYS` disables authentication. Do not use that configuration on a public network.

For a single-instance protected deployment:

```bash
SIMARENA_API_KEYS='rotate-me-1,rotate-me-2' HOST=0.0.0.0 PORT=3000 npm start
```

- Put the service behind TLS so clients use `https` and `wss`.
- Restrict CORS to the real SimArena origins rather than the MVP’s permissive setting.
- Prefer short-lived signed connection tokens over long-lived API keys in query strings.
- Do not log action/observation bodies: they may contain proprietary robot state or signed sensor URLs.
- Rate-limit session creation and set tenant quotas.
- Use Redis-backed session state and pub/sub before running more than one process or replica.
- Set payload limits at both the proxy and app. The default app limit is 1 MiB.

## Reliability rules for clients

- Reconnect only while the session has not expired; use exponential backoff with jitter.
- On reconnect, start a new episode unless the simulator can prove state continuity.
- Send a `heartbeat` during idle periods. The service echoes it to the sender.
- Handle `peer_status` immediately. A simulator should pause or hold position when the brain disconnects.
- Treat unknown message types and a mismatched `protocolVersion` as incompatible.
- Close gracefully and create a new session after expiry.

## Error model

REST errors use this envelope:

```json
{"error":{"code":"INVALID_REQUEST","message":"Invalid session request.","details":[]}}
```

WebSocket validation errors are delivered without closing the connection:

```json
{"type":"error","protocolVersion":"1.0","code":"INVALID_MESSAGE","message":"Message does not match protocol 1.0.","details":[]}
```

Connection-level failures use private close codes:

| Code | Meaning |
| --- | --- |
| `4400` | Invalid or missing role |
| `4401` | Invalid API key (HTTP upgrade rejected) |
| `4404` | Session missing, closed, or expired |
| `4409` | That role is already connected |

## Troubleshooting

**The socket closes immediately.** Check the session ID, role, expiry, API key, and whether another client already owns that role.

**`PEER_NOT_CONNECTED`.** The other role has not joined yet. Wait for `peer_status` with `connected: true` before starting the control loop.

**Actions arrive but motion is wrong.** Confirm action mode, units, joint order, limits, and control frequency. Position, velocity, and torque commands are intentionally distinct fields.

**Sensor messages exceed the payload limit.** Upload binary data to object storage and send a signed URL and metadata. Avoid base64 because it increases size and introduces allocation spikes in the control loop.

**The brain falls behind.** Drop stale observations or actions by `stepId`; do not queue unbounded control messages. Lower sensor resolution, batch inference only when the controller allows it, or increase the simulation control period.
