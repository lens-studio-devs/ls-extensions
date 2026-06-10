// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// ── The dynamicText helper (raw Component.Text, updates at runtime) ──────────
//
// | Pattern                                   | Use Case                              | Updates at Runtime? |
// |-------------------------------------------|---------------------------------------|---------------------|
// | label() / content() (ElementContent)      | Button text, static titles, icons     | No                  |
// | dynamicText() (Component.Text)            | Scores, timers, HP, messages, counters| Yes                 |
//
// Update at runtime: `textComponent.text = "new value"` — updates immediately.

private dynamicText(parent: SceneObject, name: string, text: string, role: TextRole,
    localPos: vec3, color: vec4, font: Font,
    hAlign: HorizontalAlignment = HorizontalAlignment.Center): Text {
  const textObj = this.obj(parent, name, localPos)
  this.liftInZ(textObj, DYNAMIC_TEXT_Z_OFFSET) // must be >= 0.15 for BackPlate visibility
  const tc = textObj.createComponent('Component.Text') as Text
  tc.text = text
  applyTextRole(tc, role)   // size + weight from the type scale
  tc.textFill.color = color
  tc.font = font
  tc.horizontalAlignment = hAlign
  tc.verticalAlignment = VerticalAlignment.Center
  tc.horizontalOverflow = HorizontalOverflow.Overflow
  tc.verticalOverflow = VerticalOverflow.Overflow
  // Text: depthTest ON, depthWrite OFF. The built-in text shader writes coverage
  // but not depth — exactly what's wanted. Writing depth on text would punch
  // the glyph's alpha bounding rect into the depth buffer and occlude siblings
  // the Canvas Hierarchy DFS draws after it.
  //
  // Set depthTest DIRECTLY on the Text component — Component.Text does NOT
  // expose `getMaterial(0)`; that's RenderMeshVisual / Image API. Calling it on
  // Text is a TS2339 error and a frequent LLM hallucination.
  tc.depthTest = true
  return tc
}

// ── WRONG — dynamic number collides with icon ────────────────────────────────
// Star icon at origin via content(), then dynamicText also at origin → overlap
//
//   this.content(obj, {leadingIcon: ICON_STAR, leadingIconSize: 1.8})
//   this.scoreText = this.dynamicText(obj, "Score", "0", "Headline2", new vec3(0,0,0), WHITE, FONT_BOLD)
//   this.content(obj, {text: "COINS", textSize: roleSize("Caption"), paddingLeft: 4})  // static label floats

// ── RIGHT — flex row with three children: icon, dynamic value, static label ──
// Give each piece its own `flexChild` so FlexLayout spaces them. The icon is an
// `Image` component (not `content()`); the number is `dynamicText`; the unit
// label is `label()`.

this.flexChild(parent, {w: 12, h: 2.4}, (row) => {
  const r = this.flexRow(row, 12, 2.4, {
    gap: 0.5, align: FlexAlign.Center, justify: FlexJustify.Start, padX: 0.4
  })

  // Icon slot — fixed square. Images: depthTest ON, depthWrite OFF. The
  // ImageMaterialPreset ships this way; do NOT override depthWrite to true
  // (would punch alpha bounds into the depth buffer, occluding later siblings).
  this.flexChild(r, {w: 2, h: 2}, (iconObj) => {
    const img = iconObj.createComponent("Component.Image") as Image
    const mat = requireAsset("../Materials/ImageMaterial.mat").clone() as Material
    img.mainMaterial = mat
    mat.mainPass.baseTex = ICON_STAR
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
  })

  // Dynamic number slot
  this.flexChild(r, {w: 3, h: 2.2}, (numObj) => {
    this.coinsText = this.dynamicText(numObj, "Coins", "0", "Headline2",
      new vec3(0, 0, DYNAMIC_TEXT_Z_OFFSET),
      new vec4(1, 0.85, 0.35, 1), FONT_BOLD, HorizontalAlignment.Left)
  })

  // Static unit label
  this.flexChild(r, {w: 6, h: 2}, (labelObj) => {
    this.label(labelObj, "COINS", 6, 2,
      {textSize: roleSize("Caption"), align: "left", color: new vec4(1, 0.85, 0.35, 1)})
  })
})
