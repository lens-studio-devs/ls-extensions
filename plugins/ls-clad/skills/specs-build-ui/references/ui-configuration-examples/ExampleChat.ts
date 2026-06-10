// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * ExampleChat – programmatic chat UI with tunable inspector params.
 * No prefabs or scene object refs; cards are RectangleButtons with custom visuals.
 * Tune layout and colors in the inspector.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("LensStudio:TextInputModule")
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import {
  buildRoundedRectangleOnto,
  getRoundedRectangleSizeFromText,
  ExampleRoundedRectangleOptions,
  ExampleRoundedRectangleStyle,
} from "./ExampleRoundedRectangle";
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { bindStartEvent, bindUpdateEvent } from "SnapDecorators.lspkg/decorators";
import { CHARACTER_LIMITS } from "../Utils/TextLimiter";

const CardType = { User: "User" as const, Chatbot: "Chatbot" as const };
type CardType = (typeof CardType)[keyof typeof CardType];

interface CardData {
  id: number;
  type: CardType;
  textContent: string;
  size: vec3;
  sceneObject: SceneObject | null;
}

interface VisibleCardConfig {
  card: SceneObject | null;
  position: vec3;
  positionIndex: number;
  cardIndex: number;
}

class SwipeState {
  swipedObject: SceneObject | null = null;
  originalPosition: vec3 = vec3.zero();
  originalRotation: quat = quat.quatIdentity();
  isSwipping: boolean = false;
  swipeStartTime: number = 0;
  swipeStartPosition: vec3 = vec3.zero();
}

/** Color presets: user + bot colors for Style 1 Blue/Gray and Style 1 Green/Gray */
const STYLE_BLUE_GRAY = {
  userDefault: new vec4(0.2, 0.5, 0.9, 1),
  userHover: new vec4(0.3, 0.55, 0.95, 1),
  userTriggered: new vec4(0.1, 0.35, 0.75, 1),
  userBorder: new vec4(0.1, 0.35, 0.75, 1),
  botDefault: new vec4(0.25, 0.25, 0.28, 1),
  botHover: new vec4(0.35, 0.35, 0.38, 1),
  botTriggered: new vec4(0.2, 0.2, 0.22, 1),
  botBorder: new vec4(0.2, 0.2, 0.2, 1),
};
const STYLE_GREEN_GRAY = {
  userDefault: new vec4(0.2, 0.65, 0.35, 1),
  userHover: new vec4(0.3, 0.7, 0.4, 1),
  userTriggered: new vec4(0.1, 0.5, 0.25, 1),
  userBorder: new vec4(0.1, 0.5, 0.25, 1),
  botDefault: new vec4(0.25, 0.25, 0.28, 1),
  botHover: new vec4(0.35, 0.35, 0.38, 1),
  botTriggered: new vec4(0.2, 0.2, 0.22, 1),
  botBorder: new vec4(0.2, 0.2, 0.2, 1),
};

@component
export class ExampleChat extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ExampleChat – placeholder chat component</span><br/><span style="color: #94A3B8; font-size: 11px;">No prefabs. Build your own logic and use the public API: addUserMessage(string), addBotMessage(string), getCardCount(), getCard(index) → SceneObject, getCardMessage(index) → string. Only the options below are shown.</span>')
  @ui.separator

  // ========== VISIBLE IN INSPECTOR (defaults set) ==========
  @input("string")
  @hint("Text color for all cards")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("White", "white"),
      new ComboBoxItem("Black", "black"),
      new ComboBoxItem("Gray", "gray"),
    ])
  )
  textColor: string = "white";

  @input("string")
  @hint("Style 1: one color for user, gray for bot")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Blue / Gray", "blue_gray"),
      new ComboBoxItem("Green / Gray", "green_gray"),
    ])
  )
  colorStyle: string = "blue_gray";

  @input("string")
  @hint("Layout: Aligned (centered) or Shifted (user right, bot left)")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Aligned", "aligned"),
      new ComboBoxItem("Shifted", "shifted"),
    ])
  )
  layoutStyle: string = "aligned";

  @input
  @hint("Fill chat with mock-up data (multiple sample cards)")
  testMode: boolean = true;

  @input
  @hint("Clip chat content to a window (MaskingComponent only, no scroll interaction)")
  mask: boolean = true;

  private scrollbarOffsetX: number = 13;
  private scrollbarHeight: number = 30;
  /** Mask clip (no interaction). Bounds from ScreenTransform on same object. */
  private maskingComponent: MaskingComponent | null = null;
  private maskWindowSize: vec2 = new vec2(30, 38);

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging Configuration</span>')
  @ui.label('<span style="color: #94A3B8; font-size: 11px;">Control logging output for this script instance</span>')

  @input
  @hint("Enable general logging (animation cycles, events, etc.)")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy, etc.)")
  enableLoggingLifecycle: boolean = false;

  // ========== PRIVATE (not in inspector, fixed defaults) ==========
  private cardWidth: number = 22;
  private cardMinHeight: number = 4;
  private cardMaxHeight: number = 40;
  private cardMaxLines: number = 20;
  private slotSpacingY: number = 1;
  private layoutCenterY: number = 5;
  private spacingMultiplier: number = 1.0;
  private userCardOffsetX: number = 2;
  private botCardOffsetX: number = -2;
  private archDepth: number = 0.5;
  private showScrollbar: boolean = true;
  private cardBorderSize: number = 0.1;
  private animationSpeed: number = 0.5;
  private swipeThreshold: number = 50.0;
  private chatModeChronological: boolean = true;
  private initialNumberOfCards: number = 10;
  private testInterval: number = 2.0;
  private maxTestCards: number = 40;

  private cardsContainerObject: SceneObject | null = null;
  private cards: SceneObject[] = [];
  private cardData: CardData[] = [];
  private currentIndex: number = 0;
  private swipeState: SwipeState = new SwipeState();
  private basePositions: vec3[] = [];
  private currentPositions: vec3[] = [];
  private animatingCards: Map<SceneObject, { target: vec3; isVisible: boolean }> = new Map();
  private initialized: boolean = false;
  private logger: Logger;
  private testTimer: number = 0;
  private scrollbarObject: SceneObject | null = null;
  private scrollbarSlider: Slider | null = null;
  private skipScrollbarSync: boolean = false;

  // ========== INPUT BAR ==========
  private inputBarObject: SceneObject | null = null;
  private inputFieldObject: SceneObject | null = null;
  private sendButtonObject: SceneObject | null = null;
  private inputTextComponent: Text | null = null;
  private currentInputText: string = "";
  private keyboardOptions: TextInputSystem.KeyboardOptions | null = null;
  private isKeyboardOpen: boolean = false;
  private inputBarOffsetY: number = -13;
  private inputBarHeight: number = 4;
  private sendButtonWidth: number = 5;

  onAwake(): void {
    // Canvas at the panel root in SortingType.Hierarchy (the default). DFS over
    // the SceneObject subtree owns paint order — no `renderOrder` anywhere.
    this.sceneObject.createComponent("Component.Canvas");
    this.logger = new Logger("ExampleChat", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onAwake() - Component initializing");
    }
  }

  @bindStartEvent
  onStart(): void {
    if (this.enableLoggingLifecycle) {
      this.logger.debug("LIFECYCLE: onStart() - Initializing chat");
    }
    this.initialize();
  }

  @bindUpdateEvent
  onUpdate(): void {
    this.update();
  }

  private initialize(): void {
    if (this.initialized) return;
    this.cardsContainerObject = global.scene.createSceneObject("CardsContainer");
    this.cardsContainerObject.setParent(this.sceneObject);
    this.setupBasePositions();
    this.createInitialCards();
    this.currentIndex = this.testMode ? Math.min(2, this.cardData.length - 1) : 0;
    this.recalculateDynamicPositions();
    this.layoutInitialCards();
    this.setupSwipeInteraction();
    if (this.showScrollbar) this.createScrollbar();
    if (this.mask) this.attachMasking();
    this.createInputBar();
    this.initialized = true;
    this.syncScrollbarFromIndex();
    if (this.enableLogging) {
      this.logger.debug("ExampleChat initialized with " + this.cardData.length + " cards");
    }
  }

  /** Add MaskingComponent + ScreenTransform on CardsContainer only, so input bar is never clipped. */
  private attachMasking(): void {
    const so = this.cardsContainerObject;
    if (!so) return;
    let st = so.getComponent("Component.ScreenTransform") as ScreenTransform | null;
    if (!st) {
      st = so.createComponent("Component.ScreenTransform") as ScreenTransform;
    }
    if (st) {
      const halfX = this.maskWindowSize.x * 0.5;
      // Bottom of mask: just above the input bar top edge, with a small gap
      const maskBottom = this.inputBarOffsetY + this.inputBarHeight * 0.5 + 0.5;
      // Top of mask: generous headroom above the card cluster
      const maskTop = this.layoutCenterY + 15;
      st.anchors.left = 0;
      st.anchors.right = 0;
      st.anchors.bottom = 0;
      st.anchors.top = 0;
      st.offsets.left = -halfX;
      st.offsets.right = halfX;
      st.offsets.bottom = maskBottom;
      st.offsets.top = maskTop;
    }
    this.maskingComponent =
      (so.getComponent("Component.MaskingComponent") as MaskingComponent | null) ||
      (so.createComponent("Component.MaskingComponent") as MaskingComponent);
  }

  private getNormalizedScrollValue(): number {
    const n = this.cardData.length;
    if (n <= 1) return 0;
    return this.currentIndex / (n - 1);
  }

  private createScrollbar(): void {
    const name = "ChatScrollbar";
    this.scrollbarObject = global.scene.createSceneObject(name);
    this.scrollbarObject.setParent(this.cardsContainerObject ?? this.sceneObject);
    this.scrollbarObject.getTransform().setLocalPosition(new vec3(this.scrollbarOffsetX, this.layoutCenterY, 0.1));
    const zRotDeg = -90;
    this.scrollbarObject.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, (zRotDeg * Math.PI) / 180));
    const sliderComp = this.scrollbarObject.createComponent(Slider.getTypeName()) as Slider;
    if (sliderComp) {
      sliderComp.size = new vec3(this.scrollbarHeight, 1, 0.5);
      sliderComp.initialize();
      this.scrollbarSlider = sliderComp;
      sliderComp.currentValue = 0;
      if (sliderComp.onValueChange) {
        sliderComp.onValueChange.add((value: number) => {
          if (this.skipScrollbarSync) return;
          this.setScrollValue(value);
        });
      }
    }
  }

  private syncScrollbarFromIndex(): void {
    if (this.scrollbarObject) {
      this.scrollbarObject.enabled = this.cardData.length > 1;
    }
    if (!this.scrollbarSlider) return;
    this.skipScrollbarSync = true;
    this.scrollbarSlider.currentValue = this.getNormalizedScrollValue();
    this.skipScrollbarSync = false;
  }

  public setScrollValue(normalized: number): void {
    const n = this.cardData.length;
    if (n <= 1) return;
    const clamped = Math.max(0, Math.min(1, normalized));
    const idx = Math.round(clamped * (n - 1));
    if (idx !== this.currentIndex) {
      this.updateCardLayoutToIndex(idx);
    }
  }

  private setupBasePositions(): void {
    this.basePositions = [];
    for (let i = 0; i < 5; i++) {
      const y = this.layoutCenterY + (2 - i) * this.slotSpacingY;
      this.basePositions.push(new vec3(0, y, 0));
    }
  }

  private getCardPosition(slotPosition: vec3, cardIndex: number, positionIndex: number): vec3 {
    let x = slotPosition.x;
    let z = slotPosition.z;
    if (this.layoutStyle === "shifted" && cardIndex >= 0 && cardIndex < this.cardData.length) {
      const isUser = this.cardData[cardIndex].type === CardType.User;
      x += isUser ? this.userCardOffsetX : this.botCardOffsetX;
    }
    if (this.archDepth !== 0 && positionIndex >= 0 && positionIndex <= 4) {
      z += this.archDepth * (2 - Math.abs(positionIndex - 2));
    }
    return new vec3(x, slotPosition.y, z);
  }

  private calculateCardSize(text: string): vec3 {
    return getRoundedRectangleSizeFromText(
      text,
      this.cardWidth,
      this.cardMinHeight,
      this.cardMaxHeight,
      this.cardMaxLines
    );
  }

  /**
   * Compute slot Y positions from the center outward using each card's actual height,
   * so spacing between cards is consistent and cards don't overlap.
   * Mid slot (index 2) is at layoutCenterY; others are stacked with gap between edges.
   */
  private calculateDynamicPositions(
    basePositions: vec3[],
    cardSizes: vec3[],
    spacingMultiplier: number
  ): vec3[] {
    const gap = this.slotSpacingY * spacingMultiplier;
    const centerY = this.layoutCenterY;
    const h = (i: number) => (cardSizes[i] && cardSizes[i].y > 0 ? cardSizes[i].y : this.cardMinHeight) * 0.5;
    const result: vec3[] = [];
    for (let i = 0; i < 5; i++) result.push(new vec3(basePositions[i].x, 0, basePositions[i].z));
    result[2].y = centerY;
    result[1].y = centerY + h(2) + gap + h(1);
    result[0].y = result[1].y + h(1) + gap + h(0);
    result[3].y = centerY - (h(2) + gap + h(3));
    result[4].y = result[3].y - (h(3) + gap + h(4));
    return result;
  }

  private calculateVisibleIndices(
    currentIndex: number,
    length: number
  ): { topLast: number; top: number; mid: number; bottom: number; bottomLast: number } {
    const wrap = (i: number) => ((i % length) + length) % length;
    return {
      topLast: length > 0 ? wrap(currentIndex + 2) : -1,
      top: length > 0 ? wrap(currentIndex + 1) : -1,
      mid: currentIndex,
      bottom: length > 0 ? wrap(currentIndex - 1) : -1,
      bottomLast: length > 0 ? wrap(currentIndex - 2) : -1,
    };
  }

  private createInitialCards(): void {
    const count = this.testMode ? this.initialNumberOfCards : 1;
    const welcomeText =
      "Welcome to your AI-powered learning companion! Ask me anything about the topics you're studying.";
    const text = this.testMode ? this.generateTestText(0) : welcomeText.substring(0, CHARACTER_LIMITS.BOT_CARD_TEXT);

    for (let i = 0; i < count; i++) {
      const cardType = this.testMode ? (i % 2 === 0 ? CardType.User : CardType.Chatbot) : CardType.Chatbot;
      const textContent = this.testMode ? this.generateTestText(i) : text;
      const cardData: CardData = {
        id: i,
        type: cardType,
        textContent: textContent,
        size: this.calculateCardSize(textContent),
        sceneObject: null,
      };
      const cardObj = this.createCardProgrammatically(cardData);
      cardData.sceneObject = cardObj;
      this.cards.push(cardObj);
      this.cardData.push(cardData);
    }
  }

  /** Test messages sized so stated line count matches wrap at 30 chars/line. */
  private generateTestText(index: number): string {
    const lines = [
      "Hi!",                                                                                    // 1 line
      "How are you today?",                                                                     // 1 line
      "This is a two-line message that should wrap nicely.",                                     // 2 lines (49 chars)
      "This is a three-line message for testing medium-length content and wrapping.",            // 3 lines (62 chars)
      "This is a four-line message to test the middle range of the sizing system and how the text wraps onto multiple lines.", // 4 lines (97 chars)
      "This is a five-line message that tests longer content blocks and demonstrates how the chat layout adapts when you have a lot of text in a single bubble.", // 5 lines (127 chars)
    ];
    return lines[index % lines.length];
  }

  private getCardOptions(cardData: CardData): ExampleRoundedRectangleOptions {
    const isUser = cardData.type === CardType.User;
    const preset = this.colorStyle === "green_gray" ? STYLE_GREEN_GRAY : STYLE_BLUE_GRAY;
    const textColorKey = (this.textColor === "white" || this.textColor === "black" || this.textColor === "gray" ? this.textColor : "white") as "white" | "black" | "gray";
    return {
      content: cardData.textContent,
      width: this.cardWidth,
      minHeight: this.cardMinHeight,
      maxHeight: this.cardMaxHeight,
      maxLines: this.cardMaxLines,
      style: isUser ? "user" : "bot",
      borderSize: this.cardBorderSize,
      textColor: textColorKey,
      colorDefault: isUser ? preset.userDefault : preset.botDefault,
      colorHover: isUser ? preset.userHover : preset.botHover,
      colorTriggered: isUser ? preset.userTriggered : preset.botTriggered,
      borderColor: isUser ? preset.userBorder : preset.botBorder,
    };
  }

  private createCardProgrammatically(cardData: CardData): SceneObject {
    const name = `Card_${cardData.id}_${cardData.type}`;
    const cardObj = global.scene.createSceneObject(name);
    cardObj.setParent(this.cardsContainerObject ?? this.sceneObject);
    cardObj.enabled = false;

    buildRoundedRectangleOnto(cardObj, this.getCardOptions(cardData));

    const manipulation = cardObj.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    if (manipulation) {
      manipulation.onManipulationStart.add(() => this.startSwipe(cardObj));
      manipulation.onManipulationEnd.add(() => this.endSwipe());
    }

    return cardObj;
  }

  private recalculateDynamicPositions(): void {
    let indices: { topLast: number; top: number; mid: number; bottom: number; bottomLast: number };
    if (this.chatModeChronological) {
      indices = {
        topLast: this.currentIndex + 2 < this.cardData.length ? this.currentIndex + 2 : -1,
        top: this.currentIndex + 1 < this.cardData.length ? this.currentIndex + 1 : -1,
        mid: this.currentIndex,
        bottom: this.currentIndex - 1 >= 0 ? this.currentIndex - 1 : -1,
        bottomLast: this.currentIndex - 2 >= 0 ? this.currentIndex - 2 : -1,
      };
    } else {
      indices = this.calculateVisibleIndices(this.currentIndex, this.cardData.length);
    }
    const visibleIndices = [indices.topLast, indices.top, indices.mid, indices.bottom, indices.bottomLast];
    const cardSizes = visibleIndices.map((i) =>
      i >= 0 && i < this.cardData.length ? this.cardData[i].size : new vec3(this.cardWidth, this.cardMinHeight, 0.5)
    );
    this.currentPositions = this.calculateDynamicPositions(
      this.basePositions,
      cardSizes,
      this.spacingMultiplier
    );
  }

  private layoutInitialCards(): void {
    this.cards.forEach((c) => (c.enabled = false));
    const indices = this.calculateVisibleIndices(this.currentIndex, this.cardData.length);
    const visibleIndices = [indices.topLast, indices.top, indices.mid, indices.bottom, indices.bottomLast];
    visibleIndices.forEach((cardIndex, posIndex) => {
      if (cardIndex >= 0 && cardIndex < this.cards.length) {
        const card = this.cards[cardIndex];
        card.enabled = true;
        card.getTransform().setLocalPosition(this.getCardPosition(this.currentPositions[posIndex], cardIndex, posIndex));
      }
    });
  }

  private setupSwipeInteraction(): void {
    // Swipe is already wired in createCardProgrammatically for each card
  }

  private startSwipe(card: SceneObject): void {
    this.swipeState.swipedObject = card;
    this.swipeState.originalPosition = card.getTransform().getLocalPosition();
    this.swipeState.originalRotation = card.getTransform().getLocalRotation();
    this.swipeState.isSwipping = true;
    this.swipeState.swipeStartPosition = card.getTransform().getLocalPosition();
  }

  private endSwipe(): void {
    if (!this.swipeState.isSwipping || !this.swipeState.swipedObject) return;
    this.returnCardToOriginalPosition();
    this.swipeState.isSwipping = false;
    this.swipeState.swipedObject = null;
  }

  private returnCardToOriginalPosition(): void {
    if (!this.swipeState.swipedObject) return;
    this.swipeState.swipedObject.getTransform().setLocalRotation(this.swipeState.originalRotation);
    this.animatingCards.set(this.swipeState.swipedObject, {
      target: this.swipeState.originalPosition,
      isVisible: true,
    });
  }

  private update(): void {
    this.updateAnimations();
    if (this.testMode && this.initialized) {
      this.testTimer += getDeltaTime();
      if (this.testTimer >= this.testInterval && this.cardData.length < this.maxTestCards) {
        this.addTestCard();
        this.testTimer = 0;
      }
    }
  }

  private addTestCard(): void {
    const newIndex = this.cardData.length;
    const cardType = newIndex % 2 === 0 ? CardType.User : CardType.Chatbot;
    const textContent = this.generateTestText(newIndex % 6);
    const cardData: CardData = {
      id: newIndex,
      type: cardType,
      textContent,
      size: this.calculateCardSize(textContent),
      sceneObject: null,
    };
    const cardObj = this.createCardProgrammatically(cardData);
    cardData.sceneObject = cardObj;
    this.cards.push(cardObj);
    this.cardData.push(cardData);
    this.recalculateDynamicPositions();
    this.updateCardLayoutToIndex(this.currentIndex);
  }

  private updateCardLayoutToIndex(targetIndex: number): void {
    this.currentIndex = targetIndex;
    this.recalculateDynamicPositions();
    this.cleanupCardAnimations();
    this.hideAllCards();
    let indices: { topLast: number; top: number; mid: number; bottom: number; bottomLast: number };
    if (this.chatModeChronological) {
      indices = {
        topLast: this.currentIndex + 2 < this.cardData.length ? this.currentIndex + 2 : -1,
        top: this.currentIndex + 1 < this.cardData.length ? this.currentIndex + 1 : -1,
        mid: this.currentIndex,
        bottom: this.currentIndex - 1 >= 0 ? this.currentIndex - 1 : -1,
        bottomLast: this.currentIndex - 2 >= 0 ? this.currentIndex - 2 : -1,
      };
    } else {
      indices = this.calculateVisibleIndices(this.currentIndex, this.cardData.length);
    }
    const visibleCards: VisibleCardConfig[] = [
      { card: indices.topLast >= 0 && indices.topLast < this.cards.length ? this.cards[indices.topLast] : null, position: this.currentPositions[0], positionIndex: 0, cardIndex: indices.topLast },
      { card: indices.top >= 0 && indices.top < this.cards.length ? this.cards[indices.top] : null, position: this.currentPositions[1], positionIndex: 1, cardIndex: indices.top },
      { card: indices.mid >= 0 && indices.mid < this.cards.length ? this.cards[indices.mid] : null, position: this.currentPositions[2], positionIndex: 2, cardIndex: indices.mid },
      { card: indices.bottom >= 0 && indices.bottom < this.cards.length ? this.cards[indices.bottom] : null, position: this.currentPositions[3], positionIndex: 3, cardIndex: indices.bottom },
      { card: indices.bottomLast >= 0 && indices.bottomLast < this.cards.length ? this.cards[indices.bottomLast] : null, position: this.currentPositions[4], positionIndex: 4, cardIndex: indices.bottomLast },
    ];
    visibleCards.forEach(({ card, position, positionIndex, cardIndex }) => {
      if (card) {
        card.enabled = true;
        this.animatingCards.set(card, { target: this.getCardPosition(position, cardIndex, positionIndex), isVisible: true });
      }
    });
    this.syncScrollbarFromIndex();
  }

  private cleanupCardAnimations(): void {
    this.animatingCards.clear();
  }

  private hideAllCards(): void {
    this.cards.forEach((c) => (c.enabled = false));
  }

  private updateAnimations(): void {
    const toRemove: SceneObject[] = [];
    this.animatingCards.forEach((anim, card) => {
      if (!card || !card.getTransform()) {
        toRemove.push(card);
        return;
      }
      const cur = card.getTransform().getLocalPosition();
      const dist = cur.distance(anim.target);
      if (dist < 0.1) {
        card.getTransform().setLocalPosition(anim.target);
        if (!anim.isVisible) card.enabled = false;
        toRemove.push(card);
      } else {
        card.getTransform().setLocalPosition(vec3.lerp(cur, anim.target, this.animationSpeed));
      }
    });
    toRemove.forEach((c) => this.animatingCards.delete(c));
  }

  // ========== INPUT BAR ==========

  private setupKeyboard(): void {
    this.keyboardOptions = new TextInputSystem.KeyboardOptions();
    this.keyboardOptions.keyboardType = TextInputSystem.KeyboardType.Text;
    this.keyboardOptions.returnKeyType = TextInputSystem.ReturnKeyType.Send;
    this.keyboardOptions.enablePreview = false;
    this.keyboardOptions.onTextChanged = (text: string, _range: vec2) => {
      this.currentInputText = text;
      this.updateInputDisplay(text);
    };
    this.keyboardOptions.onReturnKeyPressed = () => {
      this.sendInputMessage();
    };
    this.keyboardOptions.onKeyboardStateChanged = (isOpen: boolean) => {
      this.isKeyboardOpen = isOpen;
      if (!isOpen) {
        this.updateInputDisplay(this.currentInputText);
      }
    };
  }

  private openKeyboard(): void {
    if (!this.keyboardOptions) return;
    this.keyboardOptions.initialText = this.currentInputText;
    global.textInputSystem.requestKeyboard(this.keyboardOptions);
    this.isKeyboardOpen = true;
  }

  private sendInputMessage(): void {
    const trimmed = this.currentInputText.trim();
    if (!trimmed) return;
    this.addUserMessage(trimmed);
    this.currentInputText = "";
    if (this.isKeyboardOpen) {
      global.textInputSystem.dismissKeyboard();
      this.isKeyboardOpen = false;
    }
    this.updateInputDisplay("");
  }

  private updateInputDisplay(text: string): void {
    if (!this.inputTextComponent) return;
    const placeholder = this.testMode ? "Test mode · tap to type" : "Type a message...";
    const isPlaceholder = !text;
    this.inputTextComponent.text = isPlaceholder ? placeholder : text;
    this.inputTextComponent.textFill.color = isPlaceholder
      ? new vec4(0.45, 0.45, 0.48, 1)
      : new vec4(0.95, 0.95, 0.95, 1);
  }

  private createInputBar(): void {
    this.setupKeyboard();

    this.inputBarObject = global.scene.createSceneObject("InputBar");
    this.inputBarObject.setParent(this.sceneObject);
    this.inputBarObject.getTransform().setLocalPosition(new vec3(0, this.inputBarOffsetY, 0));

    const inputFieldWidth = this.cardWidth - this.sendButtonWidth - 1;
    const inputFieldX = -(this.cardWidth * 0.5) + (inputFieldWidth * 0.5);
    const sendButtonX = (this.cardWidth * 0.5) - (this.sendButtonWidth * 0.5);

    // Input text field (left portion)
    this.inputFieldObject = global.scene.createSceneObject("InputField");
    this.inputFieldObject.setParent(this.inputBarObject);
    this.inputFieldObject.getTransform().setLocalPosition(new vec3(inputFieldX, 0, 0));

    buildRoundedRectangleOnto(this.inputFieldObject, {
      content: "Type a message...",
      width: inputFieldWidth,
      minHeight: this.inputBarHeight,
      maxHeight: this.inputBarHeight,
      maxLines: 1,
      style: "bot",
      borderSize: 0.15,
      textColor: "gray",
      colorDefault: new vec4(0.12, 0.12, 0.15, 1),
      colorHover: new vec4(0.18, 0.18, 0.22, 1),
      colorTriggered: new vec4(0.10, 0.10, 0.12, 1),
      borderColor: new vec4(0.35, 0.35, 0.40, 1),
    });

    // Grab the text component for runtime updates and fix its rect to fit the field width
    for (let i = 0; i < this.inputFieldObject.getChildrenCount(); i++) {
      const child = this.inputFieldObject.getChild(i);
      if (child.name === "Content") {
        this.inputTextComponent = child.getComponent("Component.Text") as Text;
        break;
      }
    }
    if (this.inputTextComponent) {
      // buildRoundedRectangleOnto uses a hardcoded 9cm half-width; fix to the actual card width
      const fieldHalf = (inputFieldWidth - 4) * 0.5;
      const barHalf = this.inputBarHeight * 0.5;
      this.inputTextComponent.layoutRect = Rect.create(-fieldHalf, fieldHalf, -barHalf + 0.36, barHalf - 0.04);
      this.inputTextComponent.horizontalAlignment = HorizontalAlignment.Left;
    }

    const inputButton = this.inputFieldObject.getComponent(RectangleButton.getTypeName()) as RectangleButton;
    if (inputButton) {
      inputButton.onTriggerDown.add(() => this.openKeyboard());
    }

    // Send button (right portion)
    this.sendButtonObject = global.scene.createSceneObject("SendButton");
    this.sendButtonObject.setParent(this.inputBarObject);
    this.sendButtonObject.getTransform().setLocalPosition(new vec3(sendButtonX, 0, 0));

    const preset = this.colorStyle === "green_gray" ? STYLE_GREEN_GRAY : STYLE_BLUE_GRAY;
    buildRoundedRectangleOnto(this.sendButtonObject, {
      content: "Send",
      width: this.sendButtonWidth,
      minHeight: this.inputBarHeight,
      maxHeight: this.inputBarHeight,
      maxLines: 1,
      style: "user",
      borderSize: 0.1,
      textColor: "white",
      colorDefault: preset.userDefault,
      colorHover: preset.userHover,
      colorTriggered: preset.userTriggered,
      borderColor: preset.userBorder,
    });

    // Fix send button text rect to center "Send" within the button bounds
    for (let i = 0; i < this.sendButtonObject.getChildrenCount(); i++) {
      const child = this.sendButtonObject.getChild(i);
      if (child.name === "Content") {
        const sendTextComp = child.getComponent("Component.Text") as Text;
        if (sendTextComp) {
          const btnHalf = (this.sendButtonWidth - 2) * 0.5;
          const barHalf = this.inputBarHeight * 0.5;
          sendTextComp.layoutRect = Rect.create(-btnHalf, btnHalf, -barHalf + 0.36, barHalf - 0.04);
          sendTextComp.horizontalAlignment = HorizontalAlignment.Center;
        }
        break;
      }
    }

    const sendButton = this.sendButtonObject.getComponent(RectangleButton.getTypeName()) as RectangleButton;
    if (sendButton) {
      sendButton.onTriggerDown.add(() => this.sendInputMessage());
    }

    this.updateInputDisplay("");
  }

  // ========== PUBLIC API ==========
  public addUserMessage(text: string): void {
    const content = text.substring(0, CHARACTER_LIMITS.USER_CARD_TEXT);
    this.addCard(CardType.User, content);
  }

  public addBotMessage(text: string): void {
    const content = text.substring(0, CHARACTER_LIMITS.BOT_CARD_TEXT);
    this.addCard(CardType.Chatbot, content);
  }

  private addCard(type: CardType, textContent: string): void {
    const id = this.cardData.length;
    const cardData: CardData = { id, type, textContent, size: this.calculateCardSize(textContent), sceneObject: null };
    const cardObj = this.createCardProgrammatically(cardData);
    cardData.sceneObject = cardObj;
    this.cards.push(cardObj);
    this.cardData.push(cardData);
    this.recalculateDynamicPositions();
    this.updateCardLayoutToIndex(this.cardData.length - 1);
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public getCardCount(): number {
    return this.cardData.length;
  }

  /** Returns the scene object for the card at the given index, or null if out of range. */
  public getCard(index: number): SceneObject | null {
    if (index < 0 || index >= this.cards.length) return null;
    return this.cards[index];
  }

  /** Returns the text content of the card at the given index, or empty string if out of range. */
  public getCardMessage(index: number): string {
    if (index < 0 || index >= this.cardData.length) return "";
    return this.cardData[index].textContent;
  }
}
