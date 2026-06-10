// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * ExampleDeck – swipeable card stack. Each card has Title, Image (optional), and Description.
 * No prefabs. Swipe center card left = next, right = previous.
 * API: addCard(title, description, image?) or populate deckCards[] before Play.
 */
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import {
  RoundedRectangleVisual,
  RoundedRectangleVisualState,
} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { StateName, IMAGE_MATERIAL_ASSET } from "SpectaclesUIKit.lspkg/Scripts/Components/Element";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent } from "SnapDecorators.lspkg/decorators";

const FONT_LIGHT: Font   = requireAsset("../../Fonts/SpecsSans-Light.otf")   as Font
const FONT_REGULAR: Font = requireAsset("../../Fonts/SpecsSans-Regular.otf") as Font
const FONT_MEDIUM: Font  = requireAsset("../../Fonts/SpecsSans-Medium.otf")  as Font
const FONT_BOLD: Font    = requireAsset("../../Fonts/SpecsSans-Bold.otf")    as Font

type FontWeight = "light" | "regular" | "medium" | "bold"

// ─── Paint order ──────────────────────────────────────────────────────────────
// No manual `renderOrder` anywhere. Canvas at the root in `SortingType.Hierarchy`
// (UIKit default) walks SceneObject children in DFS order — earlier siblings paint
// first, later siblings paint on top. To bring the center card in front, we re-
// parent it last among its siblings (see `bringCardToFront` below). Per-card
// Z-separation (`centerZ` / `sideZ`) already handles depth-buffer occlusion; the
// hierarchy reorder handles the tie-break for overlapping translucent pixels.

// ─── Card dimensions ──────────────────────────────────────────────────────────
const CARD_W        = 22
const CARD_H        = 36
const CARD_HALF_W   = CARD_W / 2
const CARD_HALF_H   = CARD_H / 2
const CARD_PAD_X    = 1.5   // horizontal text inset
const CARD_TEXT_Z   = 0.12  // z-lift for text children

// Type-scale role → text size @ z=-110 (110cm). Single source of truth; pick by role,
// never a raw number. Full scale + rationale: references/spectacles-spatial-design.md → Typography.
function roleSize(role: string): number {
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
const IMAGE_SIZE    = 14    // square side in cm

// Layout with image:    title top zone | image zone | desc bottom zone
// Layout without image: title + desc fill the card
const TITLE_TOP_IMG    =  CARD_HALF_H - 1.5          // 16.5
const TITLE_BOT_IMG    =  CARD_HALF_H - 6.5          // 11.5
const IMAGE_Y_CENTER   =  3.5
const DESC_TOP_IMG     = -3.5
const DESC_BOT_IMG     = -CARD_HALF_H + 1.5          // -16.5

const TITLE_TOP_NOIMG  =  CARD_HALF_H - 1.5
const TITLE_BOT_NOIMG  =  4
const DESC_TOP_NOIMG   =  3
const DESC_BOT_NOIMG   = -CARD_HALF_H + 1.5

// ─── Card background style ────────────────────────────────────────────────────
function makeDeckStyle(): Partial<Record<StateName, RoundedRectangleVisualState>> {
  const base = new vec4(0.18, 0.18, 0.20, 1)
  const hov  = new vec4(0.24, 0.24, 0.28, 1)
  const trig = new vec4(0.13, 0.13, 0.15, 1)
  const bord = new vec4(0.30, 0.30, 0.35, 1)
  const flat = (c: vec4) => ({
    enabled: true, type: "Rectangle" as const,
    stop0: {enabled: true, percent: 0,   color: c},
    stop1: {enabled: true, percent: 0.5, color: c},
    stop2: {enabled: true, percent: 1,   color: c},
    stop3: {enabled: true, percent: 1,   color: c},
  })
  return {
    default:   {baseType: "Gradient", hasBorder: true, borderSize: 0.15, borderType: "Color", borderColor: bord, baseGradient: flat(base)},
    hovered:   {baseGradient: flat(hov)},
    triggered: {baseGradient: flat(trig)},
  }
}

// ─── Build one deck card ──────────────────────────────────────────────────────
function buildDeckCard(
  cardObj: SceneObject,
  title: string,
  description: string,
  image: Texture | undefined,
  titleFont?: Font,
  descFont?: Font,
  imageToDescGap: number = 0
): void {
  const style = makeDeckStyle()
  const btn   = cardObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
  const vis   = new RoundedRectangleVisual({sceneObject: cardObj, style})
  btn.visual  = vis
  btn.size    = new vec3(CARD_W, CARD_H, 0.5)
  btn.initialize()

  const hasImage = !!image
  const descTopImg = DESC_TOP_IMG - imageToDescGap

  // ── Title ────────────────────────────────────────────────────────────────
  const titleObj = global.scene.createSceneObject("Title")
  titleObj.setParent(cardObj)
  titleObj.getTransform().setLocalPosition(new vec3(0, 0, CARD_TEXT_Z))
  const titleComp = titleObj.createComponent("Component.Text") as Text
  titleComp.text  = title
  titleComp.size  = roleSize("Headline1")
  titleComp.layoutRect = Rect.create(
    -CARD_HALF_W + CARD_PAD_X,
     CARD_HALF_W - CARD_PAD_X,
    hasImage ? TITLE_BOT_IMG    : TITLE_BOT_NOIMG,
    hasImage ? TITLE_TOP_IMG    : TITLE_TOP_NOIMG
  )
  titleComp.horizontalOverflow = HorizontalOverflow.Wrap
  titleComp.verticalOverflow   = VerticalOverflow.Overflow
  titleComp.horizontalAlignment = HorizontalAlignment.Center
  titleComp.verticalAlignment   = VerticalAlignment.Top
  titleComp.textFill.mode  = TextFillMode.Solid
  titleComp.textFill.color = new vec4(1, 1, 1, 1)
  titleComp.depthTest      = true     // depthWrite implicit-false for text shader
  if (titleFont) titleComp.font = titleFont

  // ── Image ────────────────────────────────────────────────────────────────
  if (hasImage) {
    const imgObj = global.scene.createSceneObject("Image")
    imgObj.setParent(cardObj)
    imgObj.getTransform().setLocalPosition(new vec3(0, IMAGE_Y_CENTER, CARD_TEXT_Z + 0.02))
    imgObj.getTransform().setLocalScale(new vec3(IMAGE_SIZE, IMAGE_SIZE, 1))
    const imgComp = imgObj.createComponent("Component.Image") as Image
    imgComp.mainMaterial = IMAGE_MATERIAL_ASSET.clone()
    imgComp.mainPass.baseTex = image!
    imgComp.mainPass.depthTest = true
    imgComp.mainPass.depthWrite = false  // Image: depthTest ON, depthWrite OFF
  }

  // ── Description ──────────────────────────────────────────────────────────
  if (description) {
    const descObj = global.scene.createSceneObject("Description")
    descObj.setParent(cardObj)
    descObj.getTransform().setLocalPosition(new vec3(0, 0, CARD_TEXT_Z))
    const descComp = descObj.createComponent("Component.Text") as Text
    descComp.text  = description
    descComp.size  = roleSize("Body")
    descComp.layoutRect = Rect.create(
      -CARD_HALF_W + CARD_PAD_X,
       CARD_HALF_W - CARD_PAD_X,
      hasImage ? DESC_BOT_IMG    : DESC_BOT_NOIMG,
      hasImage ? descTopImg      : DESC_TOP_NOIMG
    )
    descComp.horizontalOverflow = HorizontalOverflow.Wrap
    descComp.verticalOverflow   = VerticalOverflow.Overflow
    descComp.horizontalAlignment = HorizontalAlignment.Left
    descComp.verticalAlignment   = VerticalAlignment.Top
    descComp.textFill.mode  = TextFillMode.Solid
    descComp.textFill.color = new vec4(0.85, 0.85, 0.88, 1)
    descComp.depthTest      = true     // depthWrite implicit-false for text shader
    if (descFont) descComp.font = descFont
  }
}

// Bring `cardObj` to the front of the deck by re-parenting it last among its
// siblings. With Canvas in `SortingType.Hierarchy` (UIKit default), later
// siblings paint on top under DFS. This replaces the old `renderOrder` knob —
// the hierarchy IS the render order.
function bringCardToFront(cardObj: SceneObject): void {
  const parent = cardObj.getParent()
  if (!parent) return
  cardObj.setParent(null)
  cardObj.setParent(parent)  // re-appends as last child
}

// ─── SwipeState ───────────────────────────────────────────────────────────────
class SwipeState {
  swipedObject: SceneObject | null = null
  originalPosition: vec3 = vec3.zero()
  isSwipping: boolean = false
  swipeStartTime: number = 0
  swipeStartPosition: vec3 = vec3.zero()
}

// ─── ExampleDeck component ────────────────────────────────────────────────────
@component
export class ExampleDeck extends BaseScriptComponent {

  @ui.label('<span style="color: #60A5FA;">ExampleDeck – swipeable card stack</span><br/><span style="color: #94A3B8; font-size: 11px;">No prefabs. Each card: Title + Image (optional) + Description. Swipe center left = next, right = previous.</span>')
  @ui.separator

  @input
  @hint("Fill deck with sample cards for testing. Uncheck to start empty — use addCard() or populate deckCards[] before Play.")
  testMode: boolean = true

  @input
  @hint("Image pool for test mode — images are sparsely distributed across cards. Leave empty for text-only cards.")
  cardImages: Texture[] = []

  @ui.separator

  @input("number", "50.0")
  @hint("Minimum swipe distance to trigger card change")
  swipeThreshold: number = 50.0

  @input("number", "0.5")
  @hint("Animation speed for card transitions (0–1)")
  animationSpeed: number = 0.5

  @input("number", "100.0")
  @hint("Minimum swipe speed to trigger quick swipe")
  swipeSpeedThreshold: number = 100.0

  @input("number", "0")
  @hint("Rotation (degrees) for left card")
  leftCardRotationZ: number = 0

  @input("number", "0")
  @hint("Rotation (degrees) for right card")
  rightCardRotationZ: number = 0

  @ui.separator

  @input("number", "0.5")
  @hint("Vertical gap in cm between the image bottom and the description text (only applies when a card has an image)")
  imageToDescGap: number = 0.5

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging")
  enableLoggingLifecycle: boolean = false

  // ─── Public data ────────────────────────────────────────────────────────
  public deckCards: {title: string; description: string; image?: Texture}[] = []

  // ─── Private state ───────────────────────────────────────────────────────
  private readonly leftPosX      = -14
  private readonly centerPosX    =   0
  private readonly rightPosX     =  14
  private readonly centerZ       =  0.4
  private readonly sideZ         = -0.8
  private readonly offScreenDist = 220
  private readonly frontScale    = 1.0
  private readonly backScale     = 0.82

  private cards:          SceneObject[] = []
  private currentIndex:   number        = 0
  private swipeState:     SwipeState    = new SwipeState()
  private animatingCards: Map<SceneObject, {target: vec3; targetScale: number; isVisible: boolean}> = new Map()
  private initialized:    boolean       = false
  private logger:         Logger

  onAwake(): void {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    // `bringCardToFront` re-parents the center card last to put it on top.
    this.sceneObject.createComponent("Component.Canvas")
    this.logger = new Logger("ExampleDeck", this.enableLogging || this.enableLoggingLifecycle, true)
  }

  @bindStartEvent
  onStart(): void {
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onStart()")
    this.initialize()
  }

  @bindUpdateEvent
  onUpdate(): void {
    this.updateAnimations()
  }

  // ─── Initialization ───────────────────────────────────────────────────────
  private initialize(): void {
    if (this.initialized) return

    if (this.testMode && this.deckCards.length === 0) {
      const pool   = this.cardImages
      const assign = (i: number) => pool.length > 0 && (i % 2 === 0 || i === 1)
        ? pool[i % pool.length]
        : undefined

      this.deckCards = [
        {
          title:       "First Card",
          description: "Swipe left to see the next card. Images are randomly distributed across the deck when you supply a pool.",
          image:       assign(0),
        },
        {
          title:       "Second Card",
          description: "This card sits in the center on start. Swipe right to go back.",
          image:       assign(1),
        },
        {
          title:       "Third Card",
          description: "Keep swiping through the deck. Each card can have a title, an image, and a description.",
          image:       assign(2),
        },
        {
          title:       "Fourth Card",
          description: "Disable test mode and call addCard() from another script to build your own deck.",
          image:       assign(3),
        },
        {
          title:       "Fifth Card",
          description: "Last sample card. Populate deckCards[] before Play for a fully custom deck.",
          image:       assign(4),
        },
      ]
    }

    for (const card of this.deckCards) {
      this._buildCard(card.title, card.description, card.image)
    }

    if (this.cards.length > 0) this.layoutInitialCards()
    this.setupCenterCardManipulation()
    this.initialized = true
    if (this.enableLogging) this.logger.debug("ExampleDeck initialized with " + this.cards.length + " cards")
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Add a card. Safe to call before or after start. Returns the card index. */
  public addCard(title: string, description: string, image?: Texture): number {
    const data = {title, description, image}
    this.deckCards.push(data)
    const index = this._buildCard(title, description, image)
    if (this.initialized && this.cards.length === 1) {
      this.layoutInitialCards()
      this.setupCenterCardManipulation()
    }
    return index
  }

  public getCardCount():    number            { return this.cards.length }
  public getCurrentIndex(): number            { return this.currentIndex }
  public getCard(i: number): SceneObject|null { return i >= 0 && i < this.cards.length ? this.cards[i] : null }
  public getCurrentCard():   SceneObject|null { return this.getCard(this.currentIndex) }

  public manualSwipeLeft(): void {
    if (!this.swipeState.isSwipping && this.cards.length > 0) {
      this.swipeState.swipedObject = this.getCurrentCard()
      this.swipeLeft()
      this.swipeState.swipedObject = null
    }
  }

  public manualSwipeRight(): void {
    if (!this.swipeState.isSwipping && this.cards.length > 0) {
      this.swipeState.swipedObject = this.getCurrentCard()
      this.swipeRight()
      this.swipeState.swipedObject = null
    }
  }

  // ─── Card building ────────────────────────────────────────────────────────
  private _buildCard(title: string, description: string, image?: Texture): number {
    const index   = this.cards.length
    const cardObj = global.scene.createSceneObject("DeckCard_" + index)
    cardObj.setParent(this.sceneObject)
    cardObj.enabled = false

    buildDeckCard(cardObj, title, description, image, this.fontForWeight("bold"), this.fontForWeight("regular"), this.imageToDescGap)

    const manip = cardObj.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation
    if (manip) {
      manip.onManipulationStart.add(() => this.startSwipe(cardObj))
      manip.onManipulationEnd.add(() => this.endSwipe())
    }

    this.cards.push(cardObj)
    return index
  }

  // ─── Slot helpers ─────────────────────────────────────────────────────────
  private positions(): vec3[] {
    return [
      new vec3(this.leftPosX,   0, this.sideZ),
      new vec3(this.centerPosX, 0, this.centerZ),
      new vec3(this.rightPosX,  0, this.sideZ),
    ]
  }

  private slotScale(slot: 0|1|2): number { return slot === 1 ? this.frontScale : this.backScale }

  private placeCard(card: SceneObject, slot: 0|1|2): void {
    const pos = this.positions()[slot]
    card.enabled = true
    card.getTransform().setLocalPosition(pos)
    const s = this.slotScale(slot)
    card.getTransform().setLocalScale(new vec3(s, s, s))
    this.applyCardRotation(card, slot)
    // Center card must paint on top. Re-parenting it last makes DFS draw it last.
    if (slot === 1) bringCardToFront(card)
    this.setManip(card, slot === 1)
  }

  private applyCardRotation(card: SceneObject, slot: 0|1|2): void {
    const t = card.getTransform()
    let rz = 0
    if (slot === 0) rz = this.leftCardRotationZ
    if (slot === 2) rz = this.rightCardRotationZ
    const e = t.getLocalRotation().toEulerAngles()
    t.setLocalRotation(quat.fromEulerAngles(e.x, e.y, (rz * Math.PI) / 180))
  }

  private setManip(card: SceneObject, enabled: boolean): void {
    const m = card.getComponent(InteractableManipulation.getTypeName()) as InteractableManipulation | null
    if (m) m.enabled = enabled
  }

  // ─── Layout ───────────────────────────────────────────────────────────────
  private layoutInitialCards(): void {
    const n = this.cards.length
    this.cards.forEach(c => { c.enabled = false; this.setManip(c, false) })
    if (n === 0) return

    if (n === 1) {
      this.placeCard(this.cards[0], 1)
      return
    }
    if (n === 2) {
      this.placeCard(this.cards[(this.currentIndex - 1 + n) % n], 0)
      this.placeCard(this.cards[this.currentIndex], 1)
      return
    }
    const li = (this.currentIndex - 1 + n) % n
    const ci = this.currentIndex
    const ri = (this.currentIndex + 1) % n
    this.placeCard(this.cards[li], 0)
    this.placeCard(this.cards[ci], 1)
    this.placeCard(this.cards[ri], 2)
  }

  private setupCenterCardManipulation(): void {
    this.cards.forEach(c => this.setManip(c, false))
    const cc = this.getCurrentCard()
    if (cc) this.setManip(cc, true)
  }

  // ─── Swipe ────────────────────────────────────────────────────────────────
  private startSwipe(card: SceneObject): void {
    this.swipeState.swipedObject     = card
    this.swipeState.originalPosition = card.getTransform().getLocalPosition()
    this.swipeState.isSwipping       = true
    this.swipeState.swipeStartTime   = getTime()
    this.swipeState.swipeStartPosition = card.getTransform().getLocalPosition()
  }

  private endSwipe(): void {
    if (!this.swipeState.isSwipping || !this.swipeState.swipedObject) return
    const cur   = this.swipeState.swipedObject.getTransform().getLocalPosition()
    const dist  = cur.distance(this.swipeState.originalPosition)
    const dt    = getTime() - this.swipeState.swipeStartTime
    const speed = dt > 0 ? dist / dt : 0
    const goRight = cur.sub(this.swipeState.originalPosition).x > 0
    if (dist > this.swipeThreshold || speed > this.swipeSpeedThreshold) {
      if (goRight) this.swipeRight(); else this.swipeLeft()
    } else {
      this.returnToCenter()
    }
    this.swipeState.isSwipping    = false
    this.swipeState.swipedObject  = null
  }

  private returnToCenter(): void {
    if (!this.swipeState.swipedObject) return
    this.animatingCards.set(this.swipeState.swipedObject, {
      target: this.positions()[1], targetScale: this.frontScale, isVisible: true,
    })
  }

  private swipeLeft(): void {
    if (!this.swipeState.swipedObject) return
    this.animateOut(this.swipeState.swipedObject, false)
    const n = this.cards.length
    if (n > 0) this.currentIndex = (this.currentIndex + 1) % n
    this.rearrange()
  }

  private swipeRight(): void {
    if (!this.swipeState.swipedObject) return
    this.animateOut(this.swipeState.swipedObject, true)
    const n = this.cards.length
    if (n > 0) this.currentIndex = (this.currentIndex - 1 + n) % n
    this.rearrange()
  }

  private animateOut(card: SceneObject, toRight: boolean): void {
    const dir = toRight ? 1 : -1
    const cp  = this.positions()[1]
    this.animatingCards.set(card, {
      target: new vec3(cp.x + this.offScreenDist * dir, cp.y, cp.z),
      targetScale: this.frontScale, isVisible: false,
    })
  }

  private rearrange(): void {
    const n = this.cards.length
    if (n === 0) return
    this.cards.forEach(c => { if (!this.animatingCards.has(c)) c.enabled = false; this.setManip(c, false) })

    if (n === 1) {
      const c = this.cards[0]
      c.enabled = true
      this.animatingCards.set(c, {target: this.positions()[1], targetScale: this.frontScale, isVisible: true})
      this.applyCardRotation(c, 1)
      bringCardToFront(c)
      this.setManip(c, true)
      return
    }

    const indices = n === 2
      ? [(this.currentIndex - 1 + n) % n, this.currentIndex]
      : [(this.currentIndex - 1 + n) % n, this.currentIndex, (this.currentIndex + 1) % n]

    const slots: Array<0|1|2> = n === 2 ? [0, 1] : [0, 1, 2]

    for (let i = 0; i < indices.length; i++) {
      const card = this.cards[indices[i]]
      const slot = slots[i]
      card.enabled = true
      this.animatingCards.set(card, {
        target: this.positions()[slot],
        targetScale: this.slotScale(slot),
        isVisible: true,
      })
      this.applyCardRotation(card, slot)
      // Center card must paint on top of the side cards — hierarchy DFS handles
      // it once we re-parent the center card last among its siblings.
      if (slot === 1) bringCardToFront(card)
      this.setManip(card, slot === 1)
    }
    this.setupCenterCardManipulation()
  }

  private fontForWeight(w: FontWeight): Font {
    switch (w) {
      case "light":  return FONT_LIGHT
      case "medium": return FONT_MEDIUM
      case "bold":   return FONT_BOLD
      default:       return FONT_REGULAR
    }
  }

  // ─── Animation update ─────────────────────────────────────────────────────
  private updateAnimations(): void {
    const done: SceneObject[] = []
    this.animatingCards.forEach((anim, card) => {
      const t    = card.getTransform()
      const pos  = t.getLocalPosition()
      const dist = pos.distance(anim.target)
      const cs   = t.getLocalScale().x
      if (dist < 0.1 && Math.abs(cs - anim.targetScale) < 0.01) {
        t.setLocalPosition(anim.target)
        t.setLocalScale(new vec3(anim.targetScale, anim.targetScale, anim.targetScale))
        if (!anim.isVisible) card.enabled = false
        done.push(card)
      } else {
        t.setLocalPosition(vec3.lerp(pos, anim.target, this.animationSpeed))
        const ns = cs + (anim.targetScale - cs) * this.animationSpeed
        t.setLocalScale(new vec3(ns, ns, ns))
      }
    })
    done.forEach(c => this.animatingCards.delete(c))
  }
}
