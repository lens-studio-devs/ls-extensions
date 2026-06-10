<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# VFX Performance Tuning

## Particle count vs. emission rate

Two separate knobs control "how many particles," and they are routinely confused:

- **Particle Count** — `ParticleCount` on `nodes_particle_emit_begin` (shown as `Count: N` in the node title). This is the **pool capacity**: the maximum number of particles that can be alive at once. It's a memory/budget ceiling, not a rate. Raising it above the live count changes nothing visible; lowering it below the live count starts recycling (clipping) live particles. The matching `Maxparticles` port on `nodes_particle_spawn_begin` is the same ceiling — keep the two consistent.
- **Emission rate** — `SpawnRate` on `node_main_particle_spawn_continuous`, interpreted per second or per frame via the `Frequency` combo. This is how many **new** particles spawn over time.

The number of particles alive at any instant in a continuous system is roughly `emission_rate × lifespan`. Once the pool is full, the oldest particles are recycled to make room for new ones.

**Sizing a smoothly-looping continuous emitter.** For continuous emission that keeps the pool saturated — steady density, no pulsing or gaps as particles recycle — set the emission rate (`Frequency: Per Second`) so the pool refills as fast as the shortest-lived particles drain it:

```
emission_rate (Per Second) = Particle Count ÷ shortest known lifespan
```

## Diagnosing overdraw

Overdraw is the number of times a single screen pixel gets shaded by overlapping particles. Transparent and additive particles are pure fill-rate cost — a fragment covered by 30 layered quads is shaded 30 times — and it is the usual reason a particle-heavy Lens drops frames on device.

To **measure** overdraw directly, turn the system into an overdraw counter:

1. Set the Output blend mode to **Add** (`BlendMode` `ItemIndex: 3` on `nodes_particle_output_begin`).
2. Emit a low, constant particle color — e.g. `(0.05, 0.05, 0.05, 1.0)`.

Each overlapping particle adds `0.05` to the framebuffer; pure white = ≥20 layers. Use `1/N` to put the white threshold at `N` layers.
