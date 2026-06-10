<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

> **Lens Runtime API** — All code here targets the Lens scripting runtime (StudioLib). Do not use these patterns in Editor API code.



# Lens Studio 2D UI — Reference Guide

Lens Studio's 2D UI layer uses **ScreenTransform** components to position elements in screen space. All screen-space elements are children of a **Full Frame Region** or **Safe Render Region** at the top of the scene hierarchy.


## ScreenTransform — Coordinate System

`ScreenTransform` uses a normalised coordinate system:
- **Origin `(0, 0)`** = centre of the parent region
- **`(1, 1)`** = top-right corner
- **`(-1, -1)`** = bottom-left corner

```typescript
const st = this.sceneObject.getComponent('Component.ScreenTransform')
```

### Anchors

Anchors pin an element to a region of its parent. The `anchors` property is a `Rect` with `left`, `right`, `bottom`, `top` in the same **[-1, 1]** space as ScreenTransform:

```typescript
// Fill the entire parent
st.anchors = Rect.create(-1, 1, -1, 1)  // left, right, bottom, top

// Pin to the top-right corner (point anchor)
st.anchors = Rect.create(1, 1, 1, 1)

// Top half of parent
st.anchors = Rect.create(-1, 1, 0, 1)

// Individual property access
st.anchors.left = -1
st.anchors.right = 1
st.anchors.bottom = 0
st.anchors.top = 1
```

### Offsets

Offsets add inset (in canvas units) from each anchor edge:

```typescript
st.offsets.left = 10    // 10 units inset from left anchor
st.offsets.right = -10  // 10 units inset from right anchor
st.offsets.bottom = 20
st.offsets.top = -20
```

### Position and size (point anchor)

When both anchors are the same point, the element is positioned by `position` (a `vec3`) and sized by `offsets` (half-extents from the anchor point). There is no `size` property on ScreenTransform:

```typescript
st.anchors.setCenter(new vec2(0.5, 0.5))  // pin to parent centre
st.position = new vec3(0, 0.3, 0)         // offset 30% up (vec3 — z is unused but required)
// Size via offsets (half-extents from anchor point):
st.offsets.left = -150; st.offsets.right = 150   // 300 units wide
st.offsets.bottom = -30; st.offsets.top = 30     // 60 units tall
```


## Coordinate Conversions

```typescript
// Screen-space (pixels) ← ScreenTransform local
const screenPx: vec2 = st.localPointToScreenPoint(new vec2(0, 0))

// ScreenTransform local ← screen-space pixels
const local: vec2 = st.screenPointToLocalPoint(touchPosScreenPx)

// World space (3D) ← ScreenTransform local
const worldPt: vec3 = st.localPointToWorldPoint(new vec2(0, 0))

// ScreenTransform local ← World space
const localPt: vec2 = st.worldPointToLocalPoint(hit.position)
```


## ScreenImage

`ScreenImage` renders a texture on a 2D quad in screen space.

```typescript
const screenImage = this.sceneObject.getComponent('Component.Image')

// Assign a texture
screenImage.mainPass.baseTex = myTexture

// Tint color (RGBA)
screenImage.mainPass.baseColor = new vec4(1, 0.5, 0, 1)

// Reset to white (no tint)
screenImage.mainPass.baseColor = new vec4(1, 1, 1, 1)

// Show/hide
screenImage.enabled = false
```

### Stretch modes (`StretchMode` enum, set in Inspector or script)
| Mode | Behaviour |
|---|---|
| **Stretch** | Non-uniform scale to match exact width/height |
| **Fit** | Uniform scale so both dimensions fit within bounds |
| **Fill** | Uniform scale so both dimensions meet/exceed bounds |
| **FitHeight** | Uniform scale to match height |
| **FitWidth** | Uniform scale to match width |
| **FillAndCut** | Fill with cropping outside bounds |


## Text Component

```typescript
const textComponent = this.sceneObject.getComponent('Component.Text')

// Set text content
textComponent.text = 'Score: ' + score

// Change font size
textComponent.size = 48

// Alignment
textComponent.horizontalAlignment = HorizontalAlignment.Center
textComponent.verticalAlignment   = VerticalAlignment.Center

// Color
textComponent.textFill.color = new vec4(1, 1, 1, 1)  // white

// Bold / italic via the text property (HTML-style tags)
textComponent.text = '<b>Bold</b> and <i>italic</i>'
```

### Setting text from untrusted sources (network data, user content)

Never assign network or user-provided strings directly — unclosed HTML tags crash the renderer. Strip tags first:

```typescript
// Strips HTML-style tags and caps length before displaying untrusted content
function safeSetText(component: Text, value: string, maxLength = 200): void {
  const stripped = (value ?? '')
    .replace(/<[^>]*>/g, '')   // strip all tag-like sequences first
    .slice(0, maxLength)        // then cap length
  component.text = stripped
}

// Usage — safe even if serverName contains malicious tags:
safeSetText(textComponent, serverName)
```


## Touch Input

### TapEvent (phone Lenses, simple tap)
```typescript
const tapEvent = this.createEvent('TapEvent')
tapEvent.bind((eventData) => {
  const screenPos: vec2 = eventData.getTapPosition()  // normalized [0-1], (0,0)=top-left
  print('Tapped at: ' + screenPos.x + ', ' + screenPos.y)
  handleTap(screenPos)
})
```

### InteractionComponent (multi-touch, drag, tap)
```typescript
const interaction = this.sceneObject.getComponent('Component.InteractionComponent')

// Touch start
interaction.onTouchStart.add((eventData: TouchStartEventArgs) => {
  print('Touch start')
})

// Touch move (drag)
interaction.onTouchMove.add((eventData: TouchMoveEventArgs) => {
  drawAtPosition(eventData.position)
})

// Touch end
interaction.onTouchEnd.add((eventData: TouchEndEventArgs) => {
  print('Touch ended')
  finalizeStroke()
})

// Tap (completed, non-moved touch)
interaction.onTap.add((eventData: TapEventArgs) => {
  print('Tapped')
})
```

> `TouchComponent` is a type alias for `InteractionComponent` — they are the same class.


## UI Buttons for Phone Lenses

For phone Lenses (not Specs), use tap regions rather than SIK PinchButton:

```typescript
// Pattern: invisible ScreenImage + InteractionComponent as a button

@component
export class TapButton extends BaseScriptComponent {
  @input label: string = 'Button'
  onTapped: (() => void) | null = null

  onAwake(): void {
    const interaction = this.sceneObject.getComponent('Component.InteractionComponent')
    interaction.onTap.add(() => {
      if (this.onTapped) this.onTapped()
    })
  }
}
```


## Color Picker Pattern

From the **Drawing** example — multiple color swatches, with a visual selection indicator:

```typescript
@component
export class ColorPicker extends BaseScriptComponent {
  @input swatches: SceneObject[]   // one per color
  @input colors: vec4[] = []       // matching color values
  @input selectionRing: SceneObject

  private selectedIndex: number = 0

  onAwake(): void {
    this.swatches.forEach((swatch, i) => {
      const interaction = swatch.getComponent('Component.InteractionComponent')
      interaction.onTap.add(() => this.selectColor(i))
    })
  }

  selectColor(index: number): void {
    this.selectedIndex = index
    // Move the selection ring to the chosen swatch
    const swatchST = this.swatches[index].getComponent('Component.ScreenTransform')
    const selST    = this.selectionRing.getComponent('Component.ScreenTransform')
    selST.position = swatchST.position    // match position

    // Apply color to the drawing material
    drawingMaterial.mainPass.penColor = this.colors[index]
  }
}
```


## Undo Stack Pattern

From the **Drawing** example:

```typescript
class UndoStack {
  private readonly maxSize = 20
  private stack: (() => void)[] = []  // each item is a "undo function"

  push(undoFn: () => void): void {
    if (this.stack.length >= this.maxSize) {
      this.stack.shift()  // drop oldest
    }
    this.stack.push(undoFn)
  }

  undo(): void {
    const fn = this.stack.pop()
    if (fn) fn()
  }

  get canUndo(): boolean {
    return this.stack.length > 0
  }
}
```


## Common Gotchas

- **Anchors use [-1, 1] space** — same as ScreenTransform local space. 0 = parent centre, ±1 = parent edges. `Rect` properties: `left`, `right`, `bottom`, `top`.
- **`position` only works when all four anchor edges are the same point** — if the anchor rect has area (stretch mode), position is ignored; use offsets instead.
- **`InteractionComponent.onTouchStart` vs `TapEvent`**: `TapEvent` fires only on completed, non-moved taps; `onTouchStart` fires immediately on contact — use `InteractionComponent` events for drawing and drag interactions.
- **`ScreenRegionComponent` region types**: `FullFrame`, `SafeRender`, `Capture`, `Preview`, `RoundButton`. These define screen region boundaries for layout, not touch blocking.
- **Pivot point** affects how a ScreenTransform rotates and scales — a pivot of `(0, 0)` rotates around the centre, `(-1, -1)` around the bottom-left corner.
- **Text HTML tags**: Lens Studio supports `<b>`, `<i>`, `<color=#rrggbbaa>`, `<size=N>` tags in `textComponent.text`. Non-closing tags crash the text renderer.
- **Never set `textComponent.text` to untrusted string content directly** (e.g., data from the network or from Dynamic Response). Untrusted strings containing unclosed HTML tags will crash the renderer; strip or escape them first.
