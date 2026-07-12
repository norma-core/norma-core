# ADR 0006: Keep live presentation and physical-model registries separate

- Date: 2026-07-12

## Context

An ST3215 bus has two independent concerns:

- live presentation of bus state, video, mirroring, and controls;
- resolution of a physical robot model, its URDF, kinematics, joint mapping, transforms, and renderer.

A physical model may reuse the shared ST3215 live UI, while the live module must remain usable for unsupported or newly attached buses. Treating both concerns as one plugin would force live presentation and model identity to evolve together.

## Decision

Live device resolution and ST3215 physical-model resolution use separate catalogs and interfaces.

The live catalog follows ADR 0005. The model catalog independently discovers `src/devices/*/st3215-model.ts` through `import.meta.glob`. A model is authored through `st3215Model()` and owns its concrete URDF path, base transform, joint names, optional joint-value mapping, and lazy renderer.

The normalized-joint renderer currently identifies a model by positive integer `motorCount`. Model IDs and motor counts are globally unique. An optional `matchesBus` predicate may further restrict a model but cannot bypass the motor-count match.

Resolution has no implicit first-model fallback. An unsupported or ambiguous bus resolves to `null` and the UI presents an explicit unsupported state. Registering a second model with the same motor count fails at startup until the model interface gains an explicit identity discriminator.

Shared ST3215 modules may query the model catalog, but they do not import concrete model implementations.

## Consequences

- Shared ST3215 live UI can support buses independently of available physical renderers.
- Concrete kinematic quirks remain local to the physical model.
- Unsupported hardware is visible instead of silently rendered as the wrong robot.
- Adding two physical models with the same motor count requires a deliberate extension of the model identity interface.
- Live presentation and physical rendering can be tested through their own seams.

## Rejected alternatives

### Add model fields to the live device manifest

This couples two independently varying concerns and turns the live interface into a collection of optional capabilities.

### Select the first registered model as a fallback

Registration order is not hardware identity. A fallback could show incorrect geometry or apply incorrect kinematics.

### Keep concrete robot configuration in shared ST3215 code

This would make the shared module depend on every physical product and spread model-specific changes across common rendering code.
