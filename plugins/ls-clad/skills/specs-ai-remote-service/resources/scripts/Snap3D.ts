// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Specs Inc. 2026
 * Snap3D text-to-3D generation API client. Submits prompts to generate 3D models with optional
 * refinement and vertex coloring, manages generation status polling, and loads resulting textures
 * and GLTF assets with event-based progress tracking.
 */
import {
  AvaliableApiTypes,
  RemoteServiceGatewayCredentials,
} from "../RemoteServiceGatewayCredentials";

import Event from "../Utils/Event";
import { Promisfy } from "../Utils/Promisfy";
import { Snap3DTypes } from "./Snap3DTypes";

const RSM_GETSTATUS = requireAsset(
  "./RemoteServiceModules/Snap3D_GetStatus.remoteServiceModule"
) as RemoteServiceModule;

const RSM_SUBMIT = requireAsset(
  "./RemoteServiceModules/Snap3D_Submit.remoteServiceModule"
) as RemoteServiceModule;

const REMOTE_MEDIA_MODULE =
  require("LensStudio:RemoteMediaModule") as RemoteMediaModule;
const REPEAT_SUBMIT_TIME = 0.25; // seconds

const INTERNET_MODULE = require("LensStudio:InternetModule") as InternetModule;

export class Snap3D {
  private static script: ScriptComponent;

  private static generateScript() {
    if (isNull(Snap3D.script)) {
      Snap3D.script = global.scene
        .createSceneObject("Snap3D")
        .createComponent("ScriptComponent");
    }
  }

  /**
   * Submits a Snap3D generation request which turns an id. Generation of 3D assets are not immediate and can be tracked using the `getStatus` method.
   *
   * This method sends a request to generate a 3D asset based on the provided request body.
   * Resolves with the task ID if the request is successful, or rejects with an error message if it fails.
   *
   * @param requestBody - The request body containing parameters for Snap3D asset generation.
   * @returns A Promise that resolves to the task ID string if successful.
   */
  public static async submit(
    requestBody: Snap3DTypes.SubmitRequestBody
  ): Promise<string> {
    Snap3D.generateScript();
    return new Promise((resolve, reject) => {
      const apiToken = RemoteServiceGatewayCredentials.getApiToken(
        AvaliableApiTypes.Snap
      );
      const submitApiRequest = RemoteApiRequest.create();
      submitApiRequest.endpoint = "submit";
      submitApiRequest.parameters = {
        "api-token": apiToken,
      };
      submitApiRequest.body = JSON.stringify({
        ...requestBody,
        use_case: "Spectacles",
      });

      RSM_SUBMIT.performApiRequest(submitApiRequest, (response) => {
        if (response.statusCode == 1) {
          const responseBody = JSON.parse(
            response.body
          ) as Snap3DTypes.SubmitResponseBody;
          resolve(responseBody.task_id);
        } else {
          reject(response.statusCode + ": " + response.body);
        }
      });
    });
  }

  /**
   * Retrieves the status of a Snap3D generation task.
   *
   * This method allows you to check the current status of a Snap3D asset generation request by providing the task ID.
   * It returns information about whether the task has completed, failed, or is still in progress.
   * If available, it also provides generated texture and GLTF assets associated with the request.
   *
   * @param requestBody - The request body containing the task ID for status checking.
   * @returns A Promise that resolves to the status response, including task state, error information, and any generated assets.
   */
  public static async getStatus(
    requestBody: Snap3DTypes.GetStatusRequestBody
  ): Promise<Snap3DTypes.GetStatusResponseBody> {
    Snap3D.generateScript();
    return new Promise((resolve, reject) => {
      const apiToken = RemoteServiceGatewayCredentials.getApiToken(
        AvaliableApiTypes.Snap
      );
      const getStatusApiRequest = RemoteApiRequest.create();
      getStatusApiRequest.endpoint = "get_status";
      getStatusApiRequest.parameters = {
        "api-token": apiToken,
      };
      getStatusApiRequest.body = JSON.stringify(requestBody);

      RSM_GETSTATUS.performApiRequest(getStatusApiRequest, (response) => {
        if (response.statusCode == 1) {
          const responseBody = JSON.parse(
            response.body
          ) as Snap3DTypes.GetStatusResponseBody;

          if (responseBody.status === "failed") {
            reject(responseBody.error_code + ": " + responseBody.error_msg);
          } else {
            resolve(responseBody);
          }
        } else {
          reject(response.statusCode + ": " + response.body);
        }
      });
    });
  }
  private static setTimeout(callback: () => void, time: number) {
    const delayedEvent = Snap3D.script.createEvent("DelayedCallbackEvent");
    delayedEvent.reset(time / 1000);
    delayedEvent.bind((eventData: any) => {
      callback();
    });
  }
  private static promiseSetTimeout(time: number): Promise<void> {
    return new Promise((resolve) => {
      Snap3D.setTimeout(() => {
        resolve();
      }, time);
    });
  }
  private static async repeatGetStatus(
    submitGetStatus: Snap3DTypes.SubmitGetStatusResults
  ) {
    const apiToken = RemoteServiceGatewayCredentials.getApiToken(
      AvaliableApiTypes.Snap
    );

    const getStatusApiRequest = RemoteApiRequest.create();
    getStatusApiRequest.endpoint = "get_status";
    getStatusApiRequest.parameters = {
      "api-token": apiToken,
    };
    const getStatusRequestBody: Snap3DTypes.GetStatusRequestBody = {
      task_id: submitGetStatus.task_id,
    };
    getStatusApiRequest.body = JSON.stringify(getStatusRequestBody);

    let taskCompleted = false;
    while (!taskCompleted) {
      try {
        const response = await Promisfy.RemoteServiceModule.performApiRequest(
          RSM_GETSTATUS,
          getStatusApiRequest
        );
        if (response.statusCode != 1) {
          taskCompleted = true;
          submitGetStatus.status = "failed";
          submitGetStatus.event.invoke([
            "failed",
            {
              errorMsg: response.body,
              errorCode: response.statusCode,
            },
          ]);
          break;
        }
        const responseBody = JSON.parse(
          response.body
        ) as Snap3DTypes.GetStatusResponseBody;

        if (responseBody.status === "failed") {
          taskCompleted = true;
          submitGetStatus.status = "failed";
          submitGetStatus.event.invoke([
            "failed",
            {
              errorMsg: responseBody.error_msg,
              errorCode: responseBody.error_code,
            },
          ]);
          break;
        }

        if (
          responseBody.stage === "base_mesh_gen" &&
          !submitGetStatus.texture
        ) {
          for (const artifact of responseBody.artifacts) {
            if (artifact.artifact_type === "image") {
              const imgUrl = artifact.url;

              const httpRequest = RemoteServiceHttpRequest.create();
              httpRequest.url = imgUrl;
              const dynamicImgResource =
                await Promisfy.InternetModule.performHttpRequest(
                  INTERNET_MODULE,
                  httpRequest
                );

              let texture: Texture;
              try {
                texture =
                  await Promisfy.RemoteMediaModule.loadResourceAsImageTexture(
                    REMOTE_MEDIA_MODULE,
                    dynamicImgResource.asResource()
                  );
                submitGetStatus.texture = texture;
                submitGetStatus.status = "running";

                const textureAssetData: Snap3DTypes.TextureAssetData = {
                  url: imgUrl,
                  texture: texture,
                };
                submitGetStatus.event.invoke([
                  artifact.artifact_type,
                  textureAssetData,
                ]);
                break;
              } catch (error) {
                submitGetStatus.status = "failed";

                submitGetStatus.event.invoke([
                  "failed",
                  {
                    errorMsg: error,
                    errorCode: -1,
                  },
                ]);
              }
            }
          }
        } else if (
          responseBody.stage === "refined_mesh_gen" &&
          !submitGetStatus.baseMeshGltf
        ) {
          for (const artifact of responseBody.artifacts) {
            if (artifact.artifact_type === "base_mesh") {
              const baseMeshUrl = artifact.url;
              const httpRequest = RemoteServiceHttpRequest.create();
              httpRequest.url = baseMeshUrl;
              const dynamicGltfResource =
                await Promisfy.InternetModule.performHttpRequest(
                  INTERNET_MODULE,
                  httpRequest
                );
              try {
                const gltfAsset =
                  await Promisfy.RemoteMediaModule.loadResourceAsGltfAsset(
                    REMOTE_MEDIA_MODULE,
                    dynamicGltfResource.asResource()
                  );
                submitGetStatus.baseMeshGltf = gltfAsset;
                submitGetStatus.status = "running";

                const gltfAssetData: Snap3DTypes.GltfAssetData = {
                  url: baseMeshUrl,
                  gltfAsset: gltfAsset,
                };
                submitGetStatus.event.invoke([
                  artifact.artifact_type,
                  gltfAssetData,
                ]);
                break;
              } catch (error) {
                submitGetStatus.status = "failed";

                submitGetStatus.event.invoke([
                  "failed",
                  {
                    errorMsg: error,
                    errorCode: -1,
                  },
                ]);
              }
            }
          }
        } else if (
          responseBody.status === "completed" &&
          !submitGetStatus.refinedMeshGltf
        ) {
          for (const artifact of responseBody.artifacts) {
            if (artifact.artifact_type === "refined_mesh") {
              const refinedMeshUrl = artifact.url;
              const httpRequest = RemoteServiceHttpRequest.create();
              httpRequest.url = refinedMeshUrl;
              const dynamicGltfResource =
                await Promisfy.InternetModule.performHttpRequest(
                  INTERNET_MODULE,
                  httpRequest
                );
              try {
                const gltfAsset =
                  await Promisfy.RemoteMediaModule.loadResourceAsGltfAsset(
                    REMOTE_MEDIA_MODULE,
                    dynamicGltfResource.asResource()
                  );
                taskCompleted = true;
                submitGetStatus.refinedMeshGltf = gltfAsset;
                submitGetStatus.status = "completed";

                const gltfAssetData: Snap3DTypes.GltfAssetData = {
                  url: refinedMeshUrl,
                  gltfAsset: gltfAsset,
                };
                submitGetStatus.event.invoke([
                  artifact.artifact_type,
                  gltfAssetData,
                ]);
                break;
              } catch (error) {
                submitGetStatus.status = "failed";
                submitGetStatus.event.invoke([
                  "failed",
                  {
                    errorMsg: error,
                    errorCode: -1,
                  },
                ]);
              }
            }
          }
        }
      } catch (error) {
        submitGetStatus.status = "failed";
        submitGetStatus.event.invoke([
          "failed",
          {
            errorMsg: error,
            errorCode: -1,
          },
        ]);
      }
      await Snap3D.promiseSetTimeout(REPEAT_SUBMIT_TIME);
    }
  }

  /**
   * Submits an image-to-3D generation request and automatically tracks its status.
   *
   * This is a convenience method for generating 3D models directly from an image URL,
   * bypassing the text-to-image generation stage. The method will skip the image generation
   * artifact and go directly to mesh generation.
   *
   * @param imageUrl - URL of the image to convert to 3D (must be publicly accessible)
   * @param options - Optional parameters for 3D generation (prompt, refine, use_vertex_color)
   * @returns A Promise that resolves to a SubmitGetStatusResults object for tracking progress
   */
  public static async submitImageTo3D(
    imageUrl: string,
    options?: {
      prompt?: string;
      refine?: boolean;
      use_vertex_color?: boolean;
    }
  ): Promise<Snap3DTypes.SubmitGetStatusResults> {
    const requestBody: Snap3DTypes.SubmitRequestBody = {
      prompt: options?.prompt || "an object",
      format: "glb",
      refine: options?.refine !== undefined ? options.refine : true,
      use_vertex_color:
        options?.use_vertex_color !== undefined
          ? options.use_vertex_color
          : false,
      image_url: imageUrl,
    };
    return Snap3D.submitAndGetStatus(requestBody);
  }

  /**
   * Submits a Snap3D generation request and automatically tracks its status.
   *
   * This method sends a request to generate a 3D asset and returns an object containing the task ID,
   * current status, and an event that emits updates as the asset is processed.
   * The event will notify you when textures or GLTF assets are generated, or if the task fails.
   *
   * For image-to-3D generation, include the optional `image_url` field in the requestBody to skip
   * text-to-image generation and use an existing image directly.
   *
   * @param requestBody - The request body containing parameters for Snap3D asset generation.
   * @returns A Promise that resolves to a SubmitGetStatusResults object, which includes the task ID, status, and an event for tracking progress and results.
   */
  public static async submitAndGetStatus(
    requestBody: Snap3DTypes.SubmitRequestBody
  ): Promise<Snap3DTypes.SubmitGetStatusResults> {
    Snap3D.generateScript();
    return new Promise((resolve, reject) => {
      const apiToken = RemoteServiceGatewayCredentials.getApiToken(
        AvaliableApiTypes.Snap
      );
      const submitApiRequest = RemoteApiRequest.create();
      submitApiRequest.endpoint = "submit";
      submitApiRequest.parameters = {
        "api-token": apiToken,
      };
      submitApiRequest.body = JSON.stringify({
        ...requestBody,
        use_case: "Spectacles",
      });

      RSM_SUBMIT.performApiRequest(submitApiRequest, async (response) => {
        if (response.statusCode == 1) {
          const responseBody = JSON.parse(
            response.body
          ) as Snap3DTypes.SubmitResponseBody;

          const submitGetStatus: Snap3DTypes.SubmitGetStatusResults = {
            task_id: responseBody.task_id,
            status: "initialized",
            event: new Event<
              [
                Snap3DTypes.ArtifactType | "failed",
                (
                  | Snap3DTypes.TextureAssetData
                  | Snap3DTypes.GltfAssetData
                  | Snap3DTypes.ErrorData
                )
              ]
            >(),
          };
          resolve(submitGetStatus);
          Snap3D.repeatGetStatus(submitGetStatus);
        } else {
          reject(response.statusCode + ": " + response.body);
        }
      });
    });
  }
}
