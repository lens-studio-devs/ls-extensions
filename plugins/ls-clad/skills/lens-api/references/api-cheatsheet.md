<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.

# Lens Studio API Cheatsheet

Quick-reference for common classes. For math types (vec2/vec3/vec4/quat/mat4) see `math.md`. For decorators and lifecycle see the parent `SKILL.md`. For Text/Image/ScreenTransform see `2d-ui.md`.

## SceneObject

The base class for all objects in the scene hierarchy.

```typescript
// Get the SceneObject this script is attached to
const sceneObj = this.getSceneObject();

// Hierarchy
const parent = sceneObj.getParent();
const childCount = sceneObj.getChildrenCount();
const child = sceneObj.getChild(0);
const children = sceneObj.children; // Array of all children

// Hierarchy manipulation
sceneObj.setParent(newParent);
sceneObj.setParentPreserveWorldTransform(newParent);
sceneObj.removeParent();

// State
sceneObj.enabled = true;
sceneObj.name = 'MyObject';
const isActive = sceneObj.isEnabledInHierarchy; // Considers parent state

// Components
const transform = sceneObj.getTransform();
const text = sceneObj.getComponent('Component.Text') as Text;
const allTexts = sceneObj.getComponents('Component.Text');
const newComp = sceneObj.createComponent('Component.Text');

// Copy operations
const copy = sceneObj.copySceneObject(original);       // copy is parented to sceneObj
const deepCopy = sceneObj.copyWholeHierarchy(original); // copy is parented to sceneObj

// Cleanup
sceneObj.destroy();

// Events
sceneObj.onEnabled.add(() => { /* enabled */ });
sceneObj.onDisabled.add(() => { /* disabled */ });
```

## Transform

Controls position, rotation, and scale of SceneObjects.

```typescript
const transform = this.getTransform();

// Local space (relative to parent)
const localPos = transform.getLocalPosition();
transform.setLocalPosition(new vec3(1, 2, 3));

const localRot = transform.getLocalRotation();
transform.setLocalRotation(quat.fromEulerAngles(0, Math.PI / 4, 0)); // radians

const localScale = transform.getLocalScale();
transform.setLocalScale(new vec3(2, 2, 2));

// World space
const worldPos = transform.getWorldPosition();
transform.setWorldPosition(new vec3(0, 0, 0));

const worldRot = transform.getWorldRotation();
transform.setWorldRotation(quat.quatIdentity());

const worldScale = transform.getWorldScale();
transform.setWorldScale(new vec3(1, 1, 1));

// Direction vectors (world space)
const forward = transform.forward;   // -Z direction
const back = transform.back;         // +Z direction
const up = transform.up;             // +Y direction
const down = transform.down;         // -Y direction
const right = transform.right;       // +X direction
const left = transform.left;         // -X direction

// Matrix operations
const worldMatrix = transform.getWorldTransform();
transform.setWorldTransform(mat4);
const invWorld = transform.getInvertedWorldTransform();
```

## Component

Base class for all components.

```typescript
// All components share these properties/methods
const component = this.getSceneObject().getComponent('Component.Text') as Text;

const sceneObj = component.getSceneObject();
const transform = component.getTransform();

component.enabled = true;
const isActive = component.isEnabledInHierarchy;

component.destroy();
```

## Common Components

### Text

```typescript
const text = sceneObj.getComponent('Component.Text') as Text;

text.text = 'Hello World';
text.size = 48;
text.textFill.color = new vec4(1, 1, 1, 1);
text.horizontalAlignment = HorizontalAlignment.Center;
text.verticalAlignment = VerticalAlignment.Center;
```

### Image

```typescript
const image = sceneObj.getComponent('Component.Image') as Image;

image.mainPass.baseTex = texture;
image.mainMaterial = material;
image.stretchMode = StretchMode.Fill;
```

### RenderMeshVisual

```typescript
const meshVisual = sceneObj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;

meshVisual.mesh = mesh;
meshVisual.mainMaterial = material;
meshVisual.setRenderOrder(10);
```

### Camera

```typescript
const camera = sceneObj.getComponent('Component.Camera') as Camera;

camera.renderTarget = renderTarget;
camera.renderLayer = LayerSet.fromNumber(1);
camera.type = Camera.Type.Perspective;
camera.fov = 60 * Math.PI / 180;  // 60 degrees, converted to radians
camera.near = 0.1;
camera.far = 1000;
```

### AudioComponent

```typescript
const audio = sceneObj.getComponent('Component.AudioComponent') as AudioComponent;

audio.audioTrack = audioTrack;
audio.volume = 0.8;
audio.play(1); // Play once
audio.play(-1); // Loop
audio.stop(true); // Fade out
audio.pause();
audio.resume();
```

## Time and Delta Time

```typescript
// Time since last frame (seconds)
const dt = getDeltaTime();

// Time since lens started (seconds)
const time = getTime();

// Example: smooth movement
const speed = 5.0;
transform.setLocalPosition(
    transform.getLocalPosition().add(
        direction.uniformScale(speed * getDeltaTime())
    )
);
```

## Tween/Animation

> **Note:** TWEEN is not built into Lens Studio. It requires importing the `@tweenjs/tween.js` npm package into your project.

```typescript
// Using TWEEN (requires @tweenjs/tween.js npm package)
const tween = new TWEEN.Tween(startValue)
    .to(endValue, duration)
    .easing(TWEEN.Easing.Quadratic.InOut)
    .onUpdate((value) => {
        // Apply value
    })
    .start();
```

### Manual Animation Pattern

```typescript
@component
export class AnimatePosition extends BaseScriptComponent {
    @input
    target: vec3 = new vec3(0, 1, 0);

    @input("float")
    @widget(new SliderWidget(0.1, 10, 0.1))
    duration: number = 1.0;

    private startPos: vec3;
    private elapsed: number = 0;
    private isAnimating: boolean = false;

    startAnimation(): void {
        this.startPos = this.getTransform().getLocalPosition();
        this.elapsed = 0;
        this.isAnimating = true;
    }

    onUpdate() {
        if (!this.isAnimating) return;

        this.elapsed += getDeltaTime();

        if (this.duration <= 0) {
            throw new Error('Duration must be greater than 0');
        }

        const t = Math.min(this.elapsed / this.duration, 1);

        // Ease in-out
        const eased = t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;

        const pos = vec3.lerp(this.startPos, this.target, eased);
        this.getTransform().setLocalPosition(pos);

        if (t >= 1) {
            this.isAnimating = false;
        }
    }
}
```

## Finding Objects and Components

```typescript
// Get components recursively in hierarchy
function findAllInHierarchy(root: SceneObject, type: string): Component[] {
    const results: Component[] = [];
    const stack: SceneObject[] = [root];

    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        stack.pop();

        const comp = current.getComponent(type as keyof ComponentNameMap);
        if (!isNull(comp)) {
            results.push(comp);
        }

        for (let i = 0; i < current.getChildrenCount(); i++) {
            stack.push(current.getChild(i));
        }
    }

    return results;
}
```

## Common Patterns

### Null-Safe Component Access

```typescript
@input
@allowUndefined
optionalTarget: SceneObject;

onAwake() {
    if (!isNull(this.optionalTarget)) {
        const text = this.optionalTarget.getComponent('Component.Text');
        if (!isNull(text)) {
            (text as Text).text = 'Found!';
        }
    }
}
```

### Cached References

```typescript
@component
export class CachedExample extends BaseScriptComponent {
    @input
    target: SceneObject;

    private targetTransform: Transform;
    private myTransform: Transform;

    onAwake() {
        // Cache own transform
        this.myTransform = this.getTransform();

        // Cache target transform with null check
        if (!isNull(this.target)) {
            this.targetTransform = this.target.getTransform();
        } else {
            // Fallback to self
            this.targetTransform = this.myTransform;
        }
    }

    onUpdate() {
        // Use cached reference (faster than getTransform() every frame)
        const pos = this.targetTransform.getWorldPosition();
    }
}
```

### Debug Visualization

```typescript
// Log position periodically
private lastLogTime: number = 0;

onUpdate() {
    const now = getTime();
    if (now - this.lastLogTime >= 1.0) {
        this.lastLogTime = now;

        const pos = this.getTransform().getWorldPosition();
        print('Position: ' + pos.x.toFixed(2) + ', ' + pos.y.toFixed(2) + ', ' + pos.z.toFixed(2));
    }
}
```
