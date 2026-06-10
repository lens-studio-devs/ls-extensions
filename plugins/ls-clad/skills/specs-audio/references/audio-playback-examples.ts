// Full copy-paste examples for AudioComponent.playbackMode on Specs.
// NOTE: playbackMode must be set in an OnStartEvent handler, not onAwake()
// (per LS lifecycle: onAwake is for createSceneObject/createComponent only;
// all property writes go in OnStartEvent configure()).

@component
export class AmbientLoop extends BaseScriptComponent {
  @input
  audio: AudioComponent

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      // ambient / background audio: default for Specs, lower power
      this.audio.playbackMode = Audio.PlaybackMode.LowPower
    })
  }
}

@component
export class ButtonClickSFX extends BaseScriptComponent {
  @input
  audio: AudioComponent

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      // button SFX / user-input: minimizes latency at higher power cost
      this.audio.playbackMode = Audio.PlaybackMode.LowLatency
    })
  }
}
