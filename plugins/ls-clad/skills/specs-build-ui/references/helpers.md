<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Layout Composition helpers

The private helper methods every generated `<Name>UI.ts` uses to compose its
layout: `obj` / `liftInZ` for SceneObject creation, `flexColumn` / `flexRow` /
`makeFlex` for flex containers, `flexChild` for registering children, and the
`GridLayout` skeleton. Copy these verbatim into the `@component` class.

## SceneObject Helper

```typescript
private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
  const sceneObject = global.scene.createSceneObject(name)
  sceneObject.setParent(parent)
  if (position) sceneObject.getTransform().setLocalPosition(position)
  return sceneObject
}

private liftInZ(sceneObject: SceneObject, zOffset: number): void {
  const transform = sceneObject.getTransform()
  const pos = transform.getLocalPosition()
  transform.setLocalPosition(new vec3(pos.x, pos.y, pos.z + zOffset))
}
```

## FlexColumn / FlexRow

Create a flex container. Properties are set inside `onInitialized` to avoid race conditions.

```typescript
private flexColumn(parent: SceneObject, width: number, height: number,
    opts?: {gap?: number, padY?: number, padX?: number, justify?: FlexJustify, align?: FlexAlign}): SceneObject {
  return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
}

private flexRow(parent: SceneObject, width: number, height: number,
    opts?: {gap?: number, padY?: number, padX?: number, justify?: FlexJustify, align?: FlexAlign}): SceneObject {
  return this.makeFlex(parent, FlexDirection.Row, width, height, opts)
}

private makeFlex(parent: SceneObject, direction: FlexDirection, width: number, height: number,
    opts?: {gap?: number, padY?: number, padX?: number, justify?: FlexJustify, align?: FlexAlign}): SceneObject {
  const container = this.obj(parent, "Flex")
  this.liftInZ(container, LAYOUT_Z_LIFT)
  const flexLayout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
  const flexItem = container.createComponent(FlexItem.getTypeName()) as FlexItem
  if (width > 0) flexItem.overrideWidth = width
  if (height > 0) flexItem.overrideHeight = height

  flexLayout.onInitialized.add(() => {
    flexLayout.width = width
    flexLayout.height = height
    flexLayout.direction = direction
    if (direction === FlexDirection.Row) {
      flexLayout.columnGap = opts?.gap ?? 0
    } else {
      flexLayout.rowGap = opts?.gap ?? 0
    }
    flexLayout.paddingTop = opts?.padY ?? 0
    flexLayout.paddingBottom = opts?.padY ?? 0
    flexLayout.paddingLeft = opts?.padX ?? 0
    flexLayout.paddingRight = opts?.padX ?? 0
    flexLayout.justifyContent = opts?.justify ?? FlexJustify.Start
    flexLayout.alignItems = opts?.align ?? FlexAlign.Stretch
  })
  return container
}
```

## FlexChild

Add a child to a flex container with size + grow configuration. Builder callback composes the child's content.

```typescript
private flexChild(parent: SceneObject, size: {w?: number, h?: number, grow?: number},
    builder: (childObject: SceneObject) => void): SceneObject {
  const child = this.obj(parent, "Item")
  this.liftInZ(child, LAYOUT_Z_LIFT)
  const flexItem = child.createComponent(FlexItem.getTypeName()) as FlexItem
  if (size.w !== undefined && size.w > 0) flexItem.overrideWidth = size.w
  if (size.h !== undefined && size.h > 0) flexItem.overrideHeight = size.h
  flexItem.flexGrow = size.grow ?? 0
  flexItem.flexShrink = 0

  builder(child)

  const parentFlexLayout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
  if (parentFlexLayout) parentFlexLayout.addItems([flexItem])
  return child
}
```

## GridLayout

Configure inside `onInitialized`. Children get `GridItem` components registered via `grid.addItems()`.

```typescript
this.flexChild(outer, {w: 26, h: 12}, (gridParent) => {
  const grid = gridParent.createComponent(GridLayout.getTypeName()) as GridLayout
  grid.onInitialized.add(() => {
    grid.width = 26
    grid.height = 12
    grid.templateColumns = "1fr 1fr"      // 2 equal columns
    grid.templateRows = "1fr 1fr"         // 2 equal rows
    grid.gap = 0.8
    grid.justifyItems = GridAlign.Stretch
    grid.alignItems = GridAlign.Stretch

    const items: GridItem[] = []
    for (const data of myData) {
      const card = this.obj(gridParent, "Card")
      const item = card.createComponent(GridItem.getTypeName()) as GridItem
      item.overrideWidth = 12.6
      item.overrideHeight = 5.6
      items.push(item)

      this.btn(card, "PrimaryNeutral", "Rectangle", 12.6, 5.6)
      // ... add content to card
    }
    grid.addItems(items)
  })
})
```
