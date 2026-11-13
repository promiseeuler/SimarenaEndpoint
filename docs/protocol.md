# Protocol 1.0 reference

All client messages include `type` and `protocolVersion: "1.0"`. Unknown top-level keys are rejected, while `observation`, `action`, sensor, task, options, metadata, and metrics objects are intentionally extensible.

## Handshake

Either role sends:

```json
{
  "type": "hello",
  "protocolVersion": "1.0",
  "client": {"name": "my-policy", "version": "2.3.0"},
  "capabilities": ["joint_position", "rgb"]
}
```

`hello` is currently acknowledged by echo. A later minor protocol can use the capability list for negotiation.

## Observation: simulator to brain

```json
{
  "type": "observation",
  "protocolVersion": "1.0",
  "episodeId": "episode-42",
  "stepId": 17,
  "timestamp": "2026-11-13T12:00:00.125Z",
  "observation": {
    "jointPositions": [0.0, -0.4, 1.2],
    "jointVelocities": [0.01, 0.0, -0.02],
    "endEffectorPose": [0.4, 0.1, 0.5, 0.0, 0.0, 0.0, 1.0],
    "sensors": {
      "front_rgb": {
        "url": "https://objects.example/frame.jpg?signature=...",
        "mediaType": "image/jpeg",
        "shape": [480, 640, 3]
      }
    },
    "task": {"instruction": "Place the apple on the plate"}
  }
}
```

Pose order is `[x, y, z, qx, qy, qz, qw]`. Units should be SI unless the session metadata explicitly declares otherwise.

## Action: brain to simulator

```json
{
  "type": "action",
  "protocolVersion": "1.0",
  "episodeId": "episode-42",
  "stepId": 17,
  "timestamp": "2026-11-13T12:00:00.140Z",
  "action": {"jointPositions": [0.02, -0.39, 1.18], "gripper": 0.8}
}
```

The action should use one primary joint command mode. The simulator decides which modes its robot supports and clamps all values.

## Reset: brain to simulator

```json
{
  "type": "reset",
  "protocolVersion": "1.0",
  "episodeId": "episode-43",
  "seed": 1234,
  "options": {"randomize": true}
}
```

## Episode result: simulator to brain

```json
{
  "type": "episode_result",
  "protocolVersion": "1.0",
  "episodeId": "episode-42",
  "success": true,
  "reward": 1.0,
  "steps": 84,
  "metrics": {"distance_to_target_m": 0.018},
  "reason": "success"
}
```

## Heartbeat

Either side sends this during idle periods and receives it back:

```json
{"type":"heartbeat","protocolVersion":"1.0","timestamp":"2026-11-13T12:00:10.000Z"}
```

## Server messages

After joining:

```json
{"type":"connected","protocolVersion":"1.0","sessionId":"...","role":"brain","peerConnected":false}
```

When the other side connects or disconnects:

```json
{"type":"peer_status","protocolVersion":"1.0","role":"simulator","connected":true}
```

For a recoverable protocol problem:

```json
{"type":"error","protocolVersion":"1.0","code":"INVALID_DIRECTION","message":"observation cannot be sent by the brain role."}
```

## Compatibility policy

The URL major version (`/v1`) and `protocolVersion` define compatibility. Additive optional fields can land within 1.x. Renaming/removing fields, changing direction or semantics, or changing required fields requires `/v2` and protocol `2.0`. Clients should ignore optional fields inside extensible payload objects but must not silently accept an unknown protocol version.
