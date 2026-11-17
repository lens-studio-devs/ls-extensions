---
name: specs-keyboard
description: Show an AR keyboard for text input in Specs using the TextInputSystem. Supports text, URL, numpad, and phone keyboard types. Load when implementing text input fields, search boxes, message entry, or any user text input.
user-invocable: false
paths: "**/*.ts"
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Keyboard — AR Text Input

**Requirements:** Lens Studio v5.7+, Snap OS v5.060+

> In Lens Studio Preview with SPECS 27 simulation, focusing a text field shows a **keyboard-simulation placeholder** ("use the hardware keyboard for input") instead of the full on-screen AR keyboard — but text entry **does** work: typing on your hardware keyboard registers in the field. So you can test text input directly in SPECS 27 Preview; the visual AR keyboard itself renders on device. (Verified in LS 5.25.)

Reference: `Sync Kit Think Out Loud/`, templates with text input fields

---

## Show Keyboard

All callbacks are set on `KeyboardOptions` before calling `requestKeyboard()`.

```typescript
@component
export class KeyboardController extends BaseScriptComponent {
  private currentText: string = ""

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.showKeyboard())
  }

  public showKeyboard(): void {
    require('LensStudio:TextInputModule')

    const options = new TextInputSystem.KeyboardOptions()
    options.enablePreview = true                               // show typed text preview above keyboard
    options.keyboardType = TextInputSystem.KeyboardType.Text  // Text | Num | Url | Phone | Password | Pin
    options.returnKeyType = TextInputSystem.ReturnKeyType.Done

    // Callbacks are set on options, NOT on global.textInputSystem
    options.onTextChanged = (text: string, range: vec2) => {
      this.currentText = text
      print("[Keyboard] Text: " + text)
    }

    options.onReturnKeyPressed = () => {
      this.onSubmit(this.currentText)
      global.textInputSystem.dismissKeyboard()
    }

    options.onKeyboardStateChanged = (isOpen: boolean) => {
      print("[Keyboard] Keyboard " + (isOpen ? "opened" : "closed"))
    }

    options.onError = (error: number, description: string) => {
      print("[Keyboard] Error " + error + ": " + description)
    }

    global.textInputSystem.requestKeyboard(options)
  }

  public dismissKeyboard(): void {
    global.textInputSystem.dismissKeyboard()
  }

  private onSubmit(text: string): void {
    print("[Keyboard] Submitted: " + text)
    // Handle submitted text — send to AI, store in sync, etc.
  }
}
```

---

## Keyboard Types

| Type | Use case |
|------|----------|
| `TextInputSystem.KeyboardType.Text` | General text, messages |
| `TextInputSystem.KeyboardType.Url` | Web addresses |
| `TextInputSystem.KeyboardType.Num` | Numbers only |
| `TextInputSystem.KeyboardType.Phone` | Phone numbers |
| `TextInputSystem.KeyboardType.Password` | Password (wearable only) |
| `TextInputSystem.KeyboardType.Pin` | PIN entry (wearable only) |

---

## KeyboardOptions Fields

| Field | Type | Description |
|-------|------|-------------|
| `keyboardType` | `KeyboardType` | Input style |
| `returnKeyType` | `ReturnKeyType` | Label on return key |
| `enablePreview` | `boolean` | Show text preview above keyboard |
| `initialText` | `string` | Pre-fill text |
| `initialSelectedRange` | `vec2` | Initial cursor selection range |
| `onTextChanged` | `(text, range) => void` | Called on every keystroke |
| `onReturnKeyPressed` | `() => void` | Called when user presses return |
| `onKeyboardStateChanged` | `(isOpen) => void` | Keyboard shown/hidden |
| `onError` | `(error, description) => void` | Error handler |

---

## TextInputSystem Methods

`requestKeyboard(options)` and `dismissKeyboard()` are shown in the class example above. Additional methods: `setEditingPosition(pos)` and `setSelectedTextRange(range: vec2)`.

---

## With IK TextInputField (UIKit)

For fully styled text input boxes, use UIKit's `TextInputField` — it
manages the on-screen keyboard for you (opens on focus, closes on blur), so you
don't drive the keyboard directly. UIKit 4.0:

```ts
import {TextInputField} from "UIKit.lspkg/Scripts/Components/TextInputField/TextInputField"

const field = object.createComponent(TextInputField.getTypeName()) as TextInputField
field.placeholderText = "Name"
field.actionSlot = "none"                     // or "voiceInput"
field.onInitialized.add(() => {
  field.fontSize = 44
  field.onReturnKeyPressed.add((text) => submit(text))
  field.onTextChanged.add((text) => preview(text))
})
```

Set sizing and subscribe in `onInitialized`; read the current value from `field.text`.

> A `TextInputField` **does** receive keystrokes under SPECS 27 Preview
> simulation via the hardware keyboard (a keyboard-simulation placeholder appears
> in place of the on-screen AR keyboard). Verified in LS 5.25 — typed text
> registered in the field.

---

## ReturnKeyType Options

`Done`, `Go`, `Next`, `Return`, `Search`, `Send`
