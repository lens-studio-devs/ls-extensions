// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Fetch Cat Facts component for the Fetch Spectacles lens.
 */
import Event from "./Events"
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger"

interface CatFact {
  fact: string
  length: number
}

const MAX_LENGTH = 93

@component
export class FetchCatFacts extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">FetchCatFacts – Fetches cat facts from a remote API</span><br/><span style="color: #94A3B8; font-size: 11px;">Triggers HTTP GET requests and exposes results via the catFactReceived event.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  catFactReceived: Event<string>

  private logger: Logger
  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private url = "https://catfact.ninja/fact?max_length=" + MAX_LENGTH

  onAwake() {
    this.logger = new Logger("FetchCatFacts", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.catFactReceived = new Event<string>()
  }

  public getCatFacts() {
    this.logger.debug("Fetching cat fact from: " + this.url)
    this.internetModule
      .fetch(this.url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      })
      .then((response) => response.json())
      .then((data) => {
        const randomCatFact = data as CatFact
        this.logger.info("Cat fact received: " + randomCatFact.fact)
        this.catFactReceived.invoke(randomCatFact.fact)
      })
      .catch((error) => this.logger.error("Fetch failed: " + error))
  }
}
