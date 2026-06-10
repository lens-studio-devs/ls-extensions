// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * ExampleVideoPlayer – programmatic video player with transport controls.
 * No prefabs. Assign a VideoTexture in the inspector — full UI is built at runtime.
 * Public API: play(), pause(), resume(), stop(), seek(t), seekRelative(dt),
 *             setVolume(v), setPlaybackRate(r), isPlaying(), getCurrentTime().
 */
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import { ElementContent } from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import { Frame, FrameAppearance } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexAlign, FlexDirection, FlexJustify } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import { Billboard } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Billboard/Billboard"

import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"
import { bindStartEvent, bindUpdateEvent } from "SnapDecorators.lspkg/decorators"

const FONT_LIGHT: Font   = requireAsset("../../Fonts/SpecsSans-Light.otf")   as Font
const FONT_REGULAR: Font = requireAsset("../../Fonts/SpecsSans-Regular.otf") as Font
const FONT_MEDIUM: Font  = requireAsset("../../Fonts/SpecsSans-Medium.otf")  as Font
const FONT_BOLD: Font    = requireAsset("../../Fonts/SpecsSans-Bold.otf")    as Font

type FontWeight = "light" | "regular" | "medium" | "bold"

const CONTENT_Z_OFFSET     = 0.08
const LAYOUT_Z_LIFT        = 0.005
const LABEL_EDGE_INSET     = 0.75
const PANEL_CONTENT_Z_LIFT = 0.005

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 9 / 16,
  "4:3":  3 / 4,
  "1:1":  1.0,
}

@component
export class ExampleVideoPlayer extends BaseScriptComponent {

  @ui.label('<span style="color: #60A5FA;">ExampleVideoPlayer – programmatic video player</span><br/><span style="color: #94A3B8; font-size: 11px;">No prefabs. Assign a VideoTexture and set duration. API: play(), pause(), resume(), stop(), seek(t), seekRelative(dt), setVolume(v), setPlaybackRate(r), isPlaying(), getCurrentTime().</span>')
  @ui.separator

  // ── Video ──────────────────────────────────────────────────────────────
  @ui.group_start("Video")
  @input
  @hint("Video texture asset to display and control (must have VideoTextureProvider)")
  videoTexture: Texture

  @input("number", "60.0")
  @hint("Total video duration in seconds — drives the seek slider and time display")
  videoDuration: number = 60.0

  @input
  @hint("Start playing automatically when the component initializes")
  autoPlay: boolean = false

  @input("number", "1")
  @hint("Loop count passed to VideoTextureProvider.play() — 0 = infinite")
  loopCount: number = 1
  @ui.group_end

  // ── Controls ───────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Controls")
  @input("number", "2.0")
  @hint("Seconds to seek per forward / rewind button press")
  seekStepSeconds: number = 2.0

  @input
  @hint("Show the volume slider below the transport controls")
  showVolumeSlider: boolean = true

  @input("number", "1.0")
  @hint("Initial volume (0 – 1)")
  initialVolume: number = 1.0

  @input("number", "1.0")
  @hint("Initial playback rate (0.5 = half speed, 2.0 = double speed)")
  initialPlaybackRate: number = 1.0
  @ui.group_end

  // ── Layout ─────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Layout")
  @input
  @hint("Outer size of the frame border in cm.")
  frameSize: vec2 = new vec2(34, 39)

  @input
  @hint("Inner cropping viewport in cm. Padding = (frameSize - croppingSize) / 2. Default sized to fit 16:9 video + time label + seek slider + transport row + volume slider.")
  croppingSize: vec2 = new vec2(32, 37)

  @input
  @hint("Lock height to the initial aspect ratio when resizing.")
  lockAspectRatio: boolean = false

  @input
  @hint("Auto-hide on hover. Off (default) = window is always visible.")
  autoShowHide: boolean = false

  @input
  @hint("Show the × close button on the frame.")
  showCloseButton: boolean = true

  @input
  @hint("Show the follow / grip button on the frame.")
  showFollowButton: boolean = true

  @input("string")
  @hint("Video display aspect ratio — determines the height of the video cell")
  @widget(new ComboBoxWidget([
    new ComboBoxItem("16:9", "16:9"),
    new ComboBoxItem("4:3",  "4:3"),
    new ComboBoxItem("1:1",  "1:1"),
  ]))
  aspectRatio: string = "16:9"

  @input("number", "0")
  @hint("World X position")
  positionX: number = 0

  @input("number", "0")
  @hint("World Y position")
  positionY: number = 0

  @input("number", "-110")
  @hint("Distance from camera in cm (negative = in front)")
  positionZ: number = -110

  @input("number", "1.5")
  @hint("Corner radius of the video display in cm (0 = sharp corners)")
  videoCornerRadius: number = 1.5
  @ui.group_end

  // ── Typography ─────────────────────────────────────────────────────────
  // Text sizing is driven by the shared type scale via roleSize() — time label
  // = Caption, transport buttons = Callout/Body, Volume label = Body. No raw
  // font-size inputs: roles keep every label on-scale @ z=-110.

  // ── Logging ────────────────────────────────────────────────────────────
  @ui.separator
  @ui.group_start("Logging")
  @input
  @hint("Enable general logging (play, pause, seek events)")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart)")
  enableLoggingLifecycle: boolean = false
  @ui.group_end

  // ── Private state ──────────────────────────────────────────────────────
  private provider:         VideoTextureProvider | null = null
  private seekSlider:       Slider | null = null
  private volumeSlider:     Slider | null = null
  private timeText:         Text   | null = null

  private playBtnObj:       SceneObject | null = null
  private pauseBtnObj:      SceneObject | null = null

  private _isPlaying:       boolean = false
  private _currentTime:     number  = 0
  private _isDragging:      boolean = false
  private _lastSeekTarget:   number  = 0
  private _wasPlayingBeforeDrag: boolean = false
  private _pendingPauseFrames: number = 0
  private skipSeekSync:     boolean = false
  private skipVolumeSync:   boolean = false
  private initialized:      boolean = false
  private logger:           Logger

  onAwake(): void {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas")
    this.logger = new Logger("ExampleVideoPlayer", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
  }

  @bindStartEvent
  onStart(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.buildUI()
    this.initProvider()
    if (this.autoPlay) this.play()
    this.initialized = true
  }

  @bindUpdateEvent
  onUpdate(): void {
    if (!this.initialized) return
    if (this._pendingPauseFrames > 0) {
      this._pendingPauseFrames--
      if (this._pendingPauseFrames === 0 && this.provider && !this._isPlaying) {
        this.provider.pause()
      }
    }
    this.tickTime()
    this.syncSeekSlider()
    this.syncTimeLabel()
  }

  // ── Provider ──────────────────────────────────────────────────────────────
  private initProvider(): void {
    if (!this.videoTexture) return
    this.provider = this.videoTexture.control as VideoTextureProvider
    if (!this.provider) {
      if (this.enableLogging) this.logger.debug("videoTexture.control is not a VideoTextureProvider")
      return
    }
    this.provider.volume = Math.max(0, Math.min(1, this.initialVolume))
    this.provider.playbackRate = Math.max(0.1, this.initialPlaybackRate)
    // Use the actual loaded video length; the inspector value is only a fallback
    // until the provider reports its real duration.
    this.adoptProviderDuration()
    const ready = (this.provider as any).onPlaybackReady
    if (ready && typeof ready.add === "function") {
      ready.add(() => this.adoptProviderDuration())
    }
  }

  private adoptProviderDuration(): void {
    if (!this.provider) return
    const real = (this.provider as any).duration as number
    if (typeof real === "number" && real > 0 && Math.abs(real - this.videoDuration) > 0.05) {
      if (this.enableLogging) {
        this.logger.debug("duration: inspector=" + this.videoDuration.toFixed(2) + " provider=" + real.toFixed(2) + " — adopting provider value")
      }
      this.videoDuration = real
      this.syncTimeLabel()
    }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  private tickTime(): void {
    if (!this._isPlaying || this._isDragging) return
    this._currentTime += getDeltaTime() * (this.provider?.playbackRate ?? this.initialPlaybackRate)
    if (this.videoDuration > 0 && this._currentTime >= this.videoDuration) {
      if (this.loopCount === 0) {
        this._currentTime = this._currentTime % this.videoDuration
      } else {
        this._currentTime = this.videoDuration
        this._isPlaying = false
        this.syncPlayPauseButtons()
      }
    }
  }

  private syncSeekSlider(): void {
    if (!this.seekSlider || this.videoDuration <= 0 || this._isDragging) return
    this.skipSeekSync = true
    this.seekSlider.currentValue = Math.min(1, this._currentTime / this.videoDuration)
    this.skipSeekSync = false
  }

  private syncTimeLabel(): void {
    if (!this.timeText) return
    this.timeText.text = this.fmt(this._currentTime) + " / " + this.fmt(this.videoDuration)
  }

  private syncPlayPauseButtons(): void {
    if (this.playBtnObj)  this.playBtnObj.enabled  = !this._isPlaying
    if (this.pauseBtnObj) this.pauseBtnObj.enabled  =  this._isPlaying
  }

  private fmt(s: number): string {
    const t = Math.max(0, Math.floor(s))
    const m = Math.floor(t / 60)
    const sec = t % 60
    return m + ":" + (sec < 10 ? "0" : "") + sec
  }

  // ── UI build ──────────────────────────────────────────────────────────────
  private buildUI(): void {
    const root = this.sceneObject
    root.createComponent(Billboard.getTypeName())
    root.getTransform().setWorldPosition(new vec3(this.positionX, this.positionY, this.positionZ))

    const pw     = this.croppingSize.x
    const ph     = this.croppingSize.y
    const aspect = ASPECT_RATIOS[this.aspectRatio] ?? (9 / 16)
    const videoH = pw * aspect

    const content = this.scenePanel(root, "VideoPlayerPanel", this.frameSize, this.croppingSize)
    const col = this.flexColumn(content, pw, ph, { gap: 0.8, padX: 0.5, padY: 0.5 })

    // 1. Video display ──────────────────────────────────────────────────
    this.flexChild(col, { w: pw, h: videoH }, (cell) => {
      this.buildVideoCell(cell, pw, videoH)
    })

    // 2. Time label ────────────────────────────────────────────────────
    this.flexChild(col, { w: pw, h: 2.2 }, (cell) => {
      this.timeText = this.dynamicText(
        cell, "Time", "0:00 / " + this.fmt(this.videoDuration),
        "Caption", new vec3(0, 0, 0.1), new vec4(1, 1, 1, 0.7),
        FONT_REGULAR, HorizontalAlignment.Center
      )
    })

    // 3. Seek slider ───────────────────────────────────────────────────
    this.flexChild(col, { w: pw, h: 2.5 }, (cell) => {
      const s = cell.createComponent(Slider.getTypeName()) as Slider
      ;(s as any)._size = new vec3(pw, 2.2, 1)
      s.initialize()
      s.currentValue = 0
      this.seekSlider = s
      // onKnobMoved fires continuously during drag; onValueChange fires on drag-end.
      // VideoTextureProvider.seek() alone doesn't refresh the texture on a paused
      // video, so we seek + resume each tick to force the decoder to produce the
      // new frame. Tiny forward drift (~one event interval) is fine because the
      // next seek snaps it back to the slider position. On release we restore the
      // pre-drag play state.
      const scrub = (t: number) => {
        if (!this.provider) return
        const clamped = Math.max(0, Math.min(t, this.videoDuration))
        if (Math.abs(clamped - this._lastSeekTarget) < 0.01) return
        this._lastSeekTarget = clamped
        this.provider.seek(clamped)
        this.provider.resume()
      }
      s.onKnobMoved.add((v: number) => {
        if (this.skipSeekSync) return
        if (!this._isDragging) {
          this._isDragging = true
          this._wasPlayingBeforeDrag = this._isPlaying
        }
        this._currentTime = v * this.videoDuration
        scrub(this._currentTime)
      })
      s.onValueChange.add((v: number) => {
        if (this.skipSeekSync) return
        const wasDragging = this._isDragging
        this._isDragging = false
        this._currentTime = v * this.videoDuration
        scrub(this._currentTime)
        // If the video was paused before the drag, re-pause at the dropped position.
        if (wasDragging && !this._wasPlayingBeforeDrag && this.provider) {
          this.provider.pause()
        }
      })
    })

    // 4. Transport controls ────────────────────────────────────────────
    const btnH = 4.0
    const btnW = (pw - 2.4) / 3
    this.flexChild(col, { w: pw, h: btnH }, (cell) => {
      const row = this.flexRow(cell, pw, btnH, {
        gap: 1.2, justify: FlexJustify.Center, align: FlexAlign.Center,
      })
      // Seek back
      this.flexChild(row, { w: btnW, h: btnH }, (bo) => {
        const btn = this.btn(bo, "Secondary", "Capsule", btnW, btnH)
        this.content(bo, { text: "⏮ " + this.seekStepSeconds + "s", textRole: "Body", fontWeight: "medium" })
        btn.onTriggerUp.add(() => this.seekRelative(-this.seekStepSeconds))
      })
      // Play / Pause toggle (two objects stacked in the same slot)
      this.flexChild(row, { w: btnW, h: btnH }, (slot) => {
        this.playBtnObj = this.obj(slot, "PlayBtn")
        const playBtn = this.btn(this.playBtnObj, "Primary", "Capsule", btnW, btnH)
        this.content(this.playBtnObj, { text: "▶ Play", textRole: "Callout", fontWeight: "bold" })
        playBtn.onTriggerUp.add(() => {
          if (this._currentTime < 0.01) this.play()
          else this.resume()
        })

        this.pauseBtnObj = this.obj(slot, "PauseBtn")
        this.pauseBtnObj.enabled = false
        const pauseBtn = this.btn(this.pauseBtnObj, "Primary", "Capsule", btnW, btnH)
        this.content(this.pauseBtnObj, { text: "⏸ Pause", textRole: "Callout", fontWeight: "bold" })
        pauseBtn.onTriggerUp.add(() => this.pause())
      })
      // Seek forward
      this.flexChild(row, { w: btnW, h: btnH }, (bo) => {
        const btn = this.btn(bo, "Secondary", "Capsule", btnW, btnH)
        this.content(bo, { text: "⏭ " + this.seekStepSeconds + "s", textRole: "Body", fontWeight: "medium" })
        btn.onTriggerUp.add(() => this.seekRelative(this.seekStepSeconds))
      })
    })

    // 5. Volume slider (optional) ──────────────────────────────────────
    if (this.showVolumeSlider) {
      this.flexChild(col, { w: pw, h: 4.2 }, (cell) => {
        const volCol = this.flexColumn(cell, pw, 4.2, { gap: 0.4 })
        this.flexChild(volCol, { w: pw, h: 1.8 }, (hdr) => {
          this.label(hdr, "Volume", pw, 1.8, { textRole: "Body", align: "center", fontWeight: "medium" })
        })
        this.flexChild(volCol, { w: pw, h: 2.2 }, (sCell) => {
          const vs = sCell.createComponent(Slider.getTypeName()) as Slider
          ;(vs as any)._size = new vec3(pw, 2.2, 1)
          vs.initialize()
          vs.currentValue = Math.max(0, Math.min(1, this.initialVolume))
          this.volumeSlider = vs
          vs.onValueChange.add((v: number) => {
            if (this.skipVolumeSync) return
            if (this.provider) this.provider.volume = v
          })
        })
      })
    }
  }

  private buildVideoCell(parent: SceneObject, w: number, h: number): void {
    const rrObj = this.obj(parent, "VideoDisplay")
    const rr = rrObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rr.cornerRadius = this.videoCornerRadius
    rr.initialize()
    rr.size = new vec2(w, h)
    if (this.videoTexture) {
      rr.useTexture = true
      rr.texture = this.videoTexture
      rr.textureMode = "Stretch"
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Start playback from the beginning. */
  public play(loops?: number): void {
    if (!this.provider) { if (this.enableLogging) this.logger.debug("play: no provider"); return }
    const n = loops ?? this.loopCount
    this.provider.play(n)
    this._isPlaying = true
    this.syncPlayPauseButtons()
    if (this.enableLogging) this.logger.debug("play(loops=" + n + ")")
  }

  /** Pause playback at the current position. */
  public pause(): void {
    if (!this.provider) return
    this.provider.pause()
    this._isPlaying = false
    this.syncPlayPauseButtons()
    if (this.enableLogging) this.logger.debug("pause()")
  }

  /** Resume from a paused position. */
  public resume(): void {
    if (!this.provider) return
    this.provider.resume()
    this._isPlaying = true
    this.syncPlayPauseButtons()
    if (this.enableLogging) this.logger.debug("resume()")
  }

  /** Pause and reset to the beginning. */
  public stop(): void {
    this.pause()
    this._currentTime = 0
    if (this.provider) this.provider.seek(0)
    this.syncSeekSlider()
    this.syncTimeLabel()
    if (this.enableLogging) this.logger.debug("stop()")
  }

  /** Seek to an absolute time in seconds. Refreshes the frame in both play and pause states. */
  public seek(seconds: number): void {
    this._currentTime = Math.max(0, Math.min(seconds, this.videoDuration))
    if (this.provider) {
      this.provider.seek(this._currentTime)
      this.provider.resume()
      // If the video was paused, defer the re-pause by ~2 frames so the decoder
      // has time to render the new frame before we stop it again.
      if (!this._isPlaying) this._pendingPauseFrames = 2
    }
    this.syncSeekSlider()
    this.syncTimeLabel()
    if (this.enableLogging) this.logger.debug("seek(" + seconds.toFixed(2) + ")")
  }

  /** Seek relative to the current position (negative = rewind). */
  public seekRelative(delta: number): void {
    this.seek(this._currentTime + delta)
  }

  /** Set volume (0–1). Also updates the volume slider UI. */
  public setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, volume))
    if (this.provider) this.provider.volume = v
    if (this.volumeSlider) {
      this.skipVolumeSync = true
      this.volumeSlider.currentValue = v
      this.skipVolumeSync = false
    }
    if (this.enableLogging) this.logger.debug("setVolume(" + v.toFixed(2) + ")")
  }

  /** Set playback rate (0.5 = half speed, 1.0 = normal, 2.0 = double). */
  public setPlaybackRate(rate: number): void {
    const r = Math.max(0.1, rate)
    if (this.provider) this.provider.playbackRate = r
    if (this.enableLogging) this.logger.debug("setPlaybackRate(" + r.toFixed(2) + ")")
  }

  public isPlaying(): boolean                           { return this._isPlaying }
  public getCurrentTime(): number                       { return this._currentTime }
  public getProvider(): VideoTextureProvider | null     { return this.provider }

  // ── Composition helpers (same pattern as ExampleModalLayout) ─────────────

  private fontForWeight(weight: FontWeight): Font {
    switch (weight) {
      case "light":  return FONT_LIGHT
      case "medium": return FONT_MEDIUM
      case "bold":   return FONT_BOLD
      default:       return FONT_REGULAR
    }
  }

  // Type-scale roles → Component.Text / ElementContent size @ z=-110 (110cm).
  // ElementContent has no weight setter, so this maps size only; callers keep
  // their own fontWeight where the face demands bold/medium.
  private roleSize(role: string): number {
    switch (role) {
      case "Title1":      return 105
      case "Title2":      return 93
      case "HeadlineXL":  return 62
      case "Headline1":   return 54
      case "Headline2":   return 48
      case "Subheadline": return 41
      case "Button":      return 39
      case "Callout":     return 39
      case "Body":        return 39
      case "Caption":     return 38
      default:            return 39
    }
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) so.getTransform().setLocalPosition(position)
    return so
  }

  private liftInZ(so: SceneObject, z: number): void {
    const t = so.getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x, p.y, p.z + z))
  }

  private dynamicText(
    parent: SceneObject, name: string, text: string, role: string,
    localPos: vec3, color: vec4, font: Font,
    hAlign: HorizontalAlignment = HorizontalAlignment.Center
  ): Text {
    const textObj = this.obj(parent, name, localPos)
    const tc = textObj.createComponent("Component.Text") as Text
    tc.text = text; tc.size = this.roleSize(role); tc.textFill.color = color; tc.font = font
    tc.horizontalAlignment = hAlign
    tc.verticalAlignment = VerticalAlignment.Center
    tc.horizontalOverflow = HorizontalOverflow.Overflow
    tc.verticalOverflow = VerticalOverflow.Overflow
    // Text: depthTest ON, depthWrite implicit (built-in text shader writes
    // coverage but not depth). NEVER set Image/Text depthWrite=true on Spectacles —
    // alpha rectangles would punch holes in the depth buffer and occlude siblings
    // the Canvas Hierarchy DFS draws after them.
    // Set depthTest DIRECTLY on the Text — Component.Text has NO getMaterial()/mainPass
    // (that's RenderMeshVisual/Image API). `(tc as any).getMaterial(0)` compiles via the
    // cast but throws at runtime ("getMaterial is not a function"). Use tc.depthTest.
    tc.depthTest = true
    return tc
  }

  // Resizable frame with toggle-on-resize cropping. Mask is enabled only
  // during onScalingStart..onScalingEnd. See
  // Scripts/UI/ResizableSamples/ResizableWindow_Cropped.ts for the standalone reference.
  private scenePanel(
    parent: SceneObject, name: string, frameSize: vec2, croppingSize: vec2
  ): SceneObject {
    const frameObj = this.obj(parent, name)
    const frame = frameObj.createComponent(Frame.getTypeName()) as Frame
    ;(frame as any)._innerSize = croppingSize
    const padX = Math.max(0, (frameSize.x - croppingSize.x) / 2)
    const padY = Math.max(0, (frameSize.y - croppingSize.y) / 2)
    ;(frame as any)._padding = new vec2(padX, padY)
    ;(frame as any)._appearance = FrameAppearance.Small

    const clipObj = this.obj(frameObj, "ResizableContent", new vec3(0, 0, PANEL_CONTENT_Z_LIFT + 0.05))
    const screenTransform = clipObj.createComponent("Component.ScreenTransform") as any
    const maskingComp = clipObj.createComponent("Component.MaskingComponent") as any
    const setAnchors = (size: vec2) => {
      screenTransform.anchors.left = -size.x / 2
      screenTransform.anchors.right = size.x / 2
      screenTransform.anchors.bottom = -size.y / 2
      screenTransform.anchors.top = size.y / 2
    }
    setAnchors(croppingSize)
    maskingComp.enabled = true

    const initRatio = croppingSize.x / Math.max(croppingSize.y, 0.001)
    let applyingAspect = false

    const apply = () => {
      frame.allowTranslation = true
      frame.allowNonUniformScaling = true
      frame.autoScaleContent = false
      frame.autoShowHide = this.autoShowHide
      if (!this.autoShowHide) frame.showVisual()
      frame.showCloseButton = this.showCloseButton
      frame.showFollowButton = this.showFollowButton
      ;(frame as any).useFollowBehavior = this.showFollowButton

      frame.onlyInteractOnBorder = true
      frame.maximumSize = croppingSize
      frame.onScalingUpdate.add(() => {
        if (this.lockAspectRatio && !applyingAspect) {
          const cur = frame.innerSize
          const expectedY = cur.x / initRatio
          if (Math.abs(expectedY - cur.y) >= 0.01) {
            applyingAspect = true
            frame.innerSize = new vec2(cur.x, expectedY)
            applyingAspect = false
          }
        }
        setAnchors(frame.innerSize)
      })
      frame.onScalingEnd.add(() => {
        maskingComp.enabled = true
      })
    }

    if (frame.roundedRectangle) apply()
    else frame.onInitialized.add(apply)

    return this.obj(clipObj, "FrameContent", new vec3(0, 0, 0))
  }

  private btn(
    so: SceneObject, style: string, shape: string,
    width: number, height: number
  ): Button {
    // No `_renderOrder` knob — paint order is owned by Canvas Hierarchy DFS.
    // Caller controls layering by SceneObject sibling position (later siblings
    // paint on top).
    const button = so.createComponent(Button.getTypeName()) as Button
    ;(button as any)._themeOverride = "SnapOS2"
    ;(button as any)._shapeSnapOS2 = shape
    ;(button as any)._styleSnapOS2 = style
    ;(button as any)._size = new vec3(width, height, 1)
    button.initialize()
    return button
  }

  private content(
    so: SceneObject,
    opts: {
      text?: string; contentAlignment?: string; textRole?: string
      paddingLeft?: number; paddingRight?: number; sizeOverride?: vec2
      useThemeColors?: boolean; textColorOverride?: vec4; fontWeight?: FontWeight
      zOffset?: number
    }
  ): ElementContent {
    // Z gap alone separates ElementContent from the button backing (depth-buffer
    // tie-break). Paint order comes from Canvas Hierarchy DFS — no renderOrder.
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    const a = ec as any
    a._zOffset = opts.zOffset ?? CONTENT_Z_OFFSET
    a._font = this.fontForWeight(opts.fontWeight ?? "regular")
    if (opts.text !== undefined) a._text = opts.text
    if (opts.contentAlignment) a._contentAlignment = opts.contentAlignment
    if (opts.textRole) a._textSize = this.roleSize(opts.textRole)
    if (opts.paddingLeft !== undefined) a._paddingLeft = opts.paddingLeft
    if (opts.paddingRight !== undefined) a._paddingRight = opts.paddingRight
    if (opts.sizeOverride) a._sizeOverride = opts.sizeOverride
    if (opts.useThemeColors !== undefined) a._useThemeColors = opts.useThemeColors
    if (opts.textColorOverride) {
      a._useTextColorOverride = true; a._textColorOverride = opts.textColorOverride
    }
    return ec
  }

  private label(
    so: SceneObject, text: string, width: number, height: number,
    opts?: {
      textRole?: string; align?: string; color?: vec4
      fontWeight?: FontWeight
    }
  ): ElementContent {
    const align = opts?.align ?? "center"
    return this.content(so, {
      text, sizeOverride: new vec2(width, height), useThemeColors: false,
      textRole: opts?.textRole ?? "Caption", contentAlignment: align,
      textColorOverride: opts?.color, fontWeight: opts?.fontWeight ?? "regular",
      paddingLeft:  align === "left"  ? LABEL_EDGE_INSET : 0,
      paddingRight: align === "right" ? LABEL_EDGE_INSET : 0,
    })
  }

  private flexColumn(
    parent: SceneObject, width: number, height: number,
    opts?: { gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign }
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
  }

  private flexRow(
    parent: SceneObject, width: number, height: number,
    opts?: { gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign }
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Row, width, height, opts)
  }

  private makeFlex(
    parent: SceneObject, direction: FlexDirection, width: number, height: number,
    opts?: { gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign }
  ): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const fl = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    const fi = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) fi.overrideWidth = width
    if (height > 0) fi.overrideHeight = height
    fl.onInitialized.add(() => {
      fl.width = width; fl.height = height; fl.direction = direction
      if (direction === FlexDirection.Row) fl.columnGap = opts?.gap ?? 0
      else fl.rowGap = opts?.gap ?? 0
      fl.paddingTop    = opts?.padY ?? 0; fl.paddingBottom = opts?.padY ?? 0
      fl.paddingLeft   = opts?.padX ?? 0; fl.paddingRight  = opts?.padX ?? 0
      fl.justifyContent = opts?.justify ?? FlexJustify.Start
      fl.alignItems     = opts?.align   ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(
    parent: SceneObject,
    size: { w?: number; h?: number; grow?: number },
    builder: (child: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const fi = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) fi.overrideWidth  = size.w
    if (size.h !== undefined && size.h > 0) fi.overrideHeight = size.h
    fi.flexGrow   = size.grow ?? 0
    fi.flexShrink = 0
    builder(child)
    const parentFl = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFl) parentFl.addItems([fi])
    return child
  }
}
