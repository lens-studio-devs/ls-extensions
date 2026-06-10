<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Setup script examples

Concrete `package.native` YAML examples for setup scripts.

## UI Button — ScreenTransform wiring

A full worked example showing anchor / offset / constraint wiring via `createScreenTransformObject`:

```yaml
SetupScript:
  code: |
    const BUTTONSIZE = new vec2(300, 50); // Default size for the button
    return function instantiate(asset, scene, target, instantiator) {
      try {
        const screenTransform = instantiator
          .getUtils()
          .createScreenTransformObject(scene, target);

        screenTransform.sceneObject.name = 'UI Button';
        const scriptComponent = instantiator.defaultInstantiate(
          asset, scene, screenTransform.sceneObject
        );

        const anchors = new Editor.Rect();
        anchors.left = 0; anchors.right = 0; anchors.top = 0; anchors.bottom = 0;
        screenTransform.anchor = anchors;

        const offset = new Editor.Rect();
        offset.left = -BUTTONSIZE.x / 2;
        offset.right = BUTTONSIZE.x / 2;
        offset.top = BUTTONSIZE.y / 2;
        offset.bottom = -BUTTONSIZE.y / 2;
        screenTransform.offset = offset;

        const constraints = screenTransform.constraints;
        constraints.fixedWidth = true;
        constraints.fixedHeight = true;
        screenTransform.constraints = constraints;

        return scriptComponent;
      } catch (e) {
        console.error('Error instantiating UIButton: ', e);
        return null;
      }
    };
```
