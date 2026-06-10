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

**Requirements:** Lens Studio v5.7+, Spectacles OS v5.060+

> The AR Keyboard does **not** appear in Lens Studio Preview with SPECS 27 simulation. Switch to simulation mode without SPECS 27 render to test.

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

## With SIK TextInputField (UIKit)

For fully styled text input boxes, use the `TextInputField` from SpectaclesUIKit:

```typescript
import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"

@input textInput: TextInputField

onAwake(): void {
  this.textInput.onTextChanged.add((text: string) => {
    print("[Input] Text: " + text)
  })
  this.textInput.onSubmit.add((text: string) => {
    this.processInput(text)
  })
}
```

The UIKit `TextInputField` handles keyboard opening/closing automatically.

---

## ReturnKeyType Options

`Done`, `Go`, `Next`, `Return`, `Search`, `Send`
