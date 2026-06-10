// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ElementContent} from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"

type RatioName = "16:9" | "4:3" | "1:1"

@component
export class CameraSetup extends BaseScriptComponent {
  @ui.separator
  @ui.label('<span style="color:#60A5FA;">Camera Setup — BackPlate + Image + Buttons</span>')

  @input
  @hint("CameraModule asset")
  camModule: CameraModule

  @input
  @hint("Base ImageMaterial — cloned per panel so each owns its baseTex")
  imageMaterial: Material

  @input
  @hint("ScreenCropTexture — provides aspect-correct crop of the live camera feed")
  cropTexture: Texture

  @input
  @hint("Camera: 0=Default_Color, 1=Left_Color, 2=Right_Color")
  @widget(new ComboBoxWidget()
    .addItem("Default_Color", 0)
    .addItem("Left_Color", 1)
    .addItem("Right_Color", 2))
  cameraSelection: number = 0

  private ratios: {name: RatioName; v: number}[] = [
    {name: "16:9", v: 16 / 9},
    {name: "4:3", v: 4 / 3},
    {name: "1:1", v: 1},
  ]
  private ratioIndex = 0
  private baseWidth = 16   // cm per panel

  private cameraTexture: Texture | null = null
  private provider: CameraTextureProvider | null = null
  private frameReg: EventRegistration | null = null
  private capturing = false

  private liveMat: Material | null = null
  private capturedMat: Material | null = null
  private liveST: ScreenTransform | null = null
  private capturedST: ScreenTransform | null = null
  private ratioLabel: ElementContent | null = null

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("OnDestroyEvent").bind(() => this.cleanup())
  }

  private start(): void {
    this.buildUI()
    this.applyRatio()
    this.startCameraStream()
  }

  private buildUI(): void {
    const root = this.getSceneObject()

    // World-space Canvas — gives child ScreenTransforms a cm-based context.
    const canvasObj = this.obj(root, "Canvas")
    const canvas = canvasObj.createComponent("Component.Canvas") as Canvas
    canvas.unitType = Canvas.UnitType.World
    canvas.offsetUnit = Canvas.OffsetUnit.World
    canvas.setSize(new vec2(40, 30))

    // Visible chrome behind the images — pushed back so it never z-fights with content.
    const plateObj = this.obj(canvasObj, "BackPlate", new vec3(0, 0, -0.1))
    const plate = plateObj.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "dark"
    plate.size = new vec2(40, 30)

    // Two empty SceneObjects, each holding ScreenTransform + Image driven by the camera Texture.
    // Position is controlled by ScreenTransform offsets (not Transform xy, which ST overrides).
    this.liveMat = this.imageMaterial.clone()
    this.liveST = this.makeImage(canvasObj, "LiveFeed", -9, 2, this.liveMat)

    this.capturedMat = this.imageMaterial.clone()
    this.capturedST = this.makeImage(canvasObj, "Captured", 9, 2, this.capturedMat)

    // Button bar — two SUIK buttons below.
    const bar = this.obj(canvasObj, "ButtonBar", new vec3(0, -11, 0.1))
    this.makeButton(bar, new vec3(-6, 0, 0), "Primary", "Capture", () => this.capturePhoto())
    const r = this.makeButton(bar, new vec3(6, 0, 0), "Secondary", this.ratioLabelText(), () => this.cycleRatio())
    this.ratioLabel = r
  }

  private makeImage(parent: SceneObject, name: string, cx: number, cy: number, mat: Material): ScreenTransform {
    const o = this.obj(parent, name)
    const st = o.createComponent("Component.ScreenTransform") as ScreenTransform
    st.anchors.left = 0; st.anchors.right = 0
    st.anchors.top = 0; st.anchors.bottom = 0
    ;(st as any).centerOffset = new vec2(cx, cy) // remembered for sizeST
    const img = o.createComponent("Component.Image") as Image
    img.mainMaterial = mat
    img.setRenderOrder(10)
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = true
    // Push the image SceneObject forward in Z so it sits in front of the BackPlate.
    o.getTransform().setLocalPosition(new vec3(0, 0, 0.1))
    return st
  }

  private makeButton(parent: SceneObject, pos: vec3, style: string, text: string, onClick: () => void): ElementContent {
    const slot = this.obj(parent, "Btn", pos)
    const button = slot.createComponent(Button.getTypeName()) as Button
    const a = button as any
    a._themeOverride = "SnapOS2"
    a._shapeSnapOS2 = "Capsule"
    a._styleSnapOS2 = style
    a._size = new vec3(8, 3, 1)
    button.initialize()

    const ec = slot.createComponent(ElementContent.getTypeName()) as ElementContent
    const ea = ec as any
    ea._zOffset = 0.08
    ea._renderOrderOffset = 8
    ea._text = text
    ea._textSize = 22
    ea._contentAlignment = "center"
    ea._useThemeColors = true

    button.onTriggerUp.add(onClick)
    return ec
  }

  private obj(parent: SceneObject, name: string, pos?: vec3): SceneObject {
    const o = global.scene.createSceneObject(name)
    o.setParent(parent)
    if (pos) o.getTransform().setLocalPosition(pos)
    return o
  }

  private startCameraStream(): void {
    const request = CameraModule.createCameraRequest()
    request.cameraId = this.resolveCameraId()
    this.cameraTexture = this.camModule.requestCamera(request)
    this.provider = this.cameraTexture.control as CameraTextureProvider

    // Wire the crop provider so we can change aspect by changing cropRect.
    if (this.cropTexture && this.cameraTexture) {
      const cp = this.cropTexture.control as RectCropTextureProvider
      cp.inputTexture = this.cameraTexture
    }
    this.applyCrop()

    // Live panel reads through the crop provider; aspect changes are real crops.
    if (this.liveMat && this.cropTexture) this.liveMat.mainPass.baseTex = this.cropTexture
    this.frameReg = this.provider.onNewFrame.add(() => {})
  }

  private resolveCameraId(): CameraModule.CameraId {
    switch (this.cameraSelection) {
      case 1: return CameraModule.CameraId.Left_Color
      case 2: return CameraModule.CameraId.Right_Color
      default: return CameraModule.CameraId.Default_Color
    }
  }

  public capturePhoto(): void {
    if (this.capturing || !this.capturedMat) return
    const source = this.cropTexture ?? this.cameraTexture
    if (!source) return
    this.capturing = true
    // Freeze the currently-cropped frame. Right panel keeps the snapshot;
    // left keeps streaming.
    const frozen = source.copyFrame()
    this.capturedMat.mainPass.baseTex = frozen
    print("[CameraSetup] frame captured (frozen copy)")
    this.capturing = false
  }

  public cycleRatio(): void {
    this.ratioIndex = (this.ratioIndex + 1) % this.ratios.length
    this.applyRatio()
    this.applyCrop()
    if (this.ratioLabel) (this.ratioLabel as any)._text = this.ratioLabelText()
  }

  private applyCrop(): void {
    if (!this.cropTexture) return
    const cp = this.cropTexture.control as RectCropTextureProvider
    // Source camera aspect (sensible default if API gives us nothing): 4/3.
    const sourceAspect = 4 / 3
    const targetAspect = this.ratios[this.ratioIndex].v
    let halfW = 1
    let halfH = 1
    if (targetAspect > sourceAspect) {
      // Target wider → keep full width, crop top/bottom.
      halfH = sourceAspect / targetAspect
    } else {
      // Target taller (or equal) → keep full height, crop left/right.
      halfW = targetAspect / sourceAspect
    }
    cp.cropRect.left = -halfW
    cp.cropRect.right = halfW
    cp.cropRect.bottom = -halfH
    cp.cropRect.top = halfH
  }

  private applyRatio(): void {
    const r = this.ratios[this.ratioIndex].v
    const w = this.baseWidth
    const h = w / r
    this.sizeST(this.liveST, w, h)
    this.sizeST(this.capturedST, w, h)
  }

  private sizeST(st: ScreenTransform | null, w: number, h: number): void {
    if (!st) return
    const c = (st as any).centerOffset as vec2 | undefined
    const cx = c ? c.x : 0
    const cy = c ? c.y : 0
    const hw = w / 2
    const hh = h / 2
    st.offsets.left = cx - hw
    st.offsets.right = cx + hw
    st.offsets.bottom = cy - hh
    st.offsets.top = cy + hh
  }

  private ratioLabelText(): string { return "Ratio " + this.ratios[this.ratioIndex].name }

  private cleanup(): void {
    if (this.provider && this.frameReg) this.provider.onNewFrame.remove(this.frameReg)
  }
}
