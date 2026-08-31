using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using Venviewer.NativeCapture;

internal static class CapturePolicyTests
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 2)
            {
                throw new InvalidOperationException(
                    "The digest-bound camera profile and installed Newtonsoft.Json paths are required.");
            }
            string newtonsoftPath = Path.GetFullPath(args[1]);
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs eventArgs)
            {
                var requested = new AssemblyName(eventArgs.Name);
                return String.Equals(requested.Name, "Newtonsoft.Json", StringComparison.Ordinal)
                    ? Assembly.LoadFrom(newtonsoftPath)
                    : null;
            };
            FixedCameraProfile profile = FixedCameraProfile.Load(args[0], CapturePolicy.CameraProfileSha256);
            TestCanonicalPathGate();
            TestRawCoordinateTransform(profile);
            TestFixedCameraProfile(profile);
            TestShaGate();
            TestOutputPathGate();
            TestSandboxAndReadinessPolicy();
            TestNativeCaptureLifecycleState();
            TestSceneLoadReceiptContract();
            TestNativeRenderModeContract();
            TestReadOnlyUrpRendererInventoryContract();
            TestSnapFrameCaptureRoutePolicy();
            TestPngDimensionGate();
            TestDecodedRasterAdmissionGate();
            TestSnapshotChangeGate();

            if (args.Any(value => String.Equals(value, "--live", StringComparison.Ordinal)))
            {
                TestLiveCanonicalPackageReceipt();
            }

            Console.WriteLine("PASS: capture policy tests");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("FAIL: " + exception);
            return 1;
        }
    }

    private static void TestSceneLoadReceiptContract()
    {
        var fields = new HashSet<string>(typeof(SceneLoadReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "freshProjectStateVerified",
            "temporaryProjectCreationSucceeded",
            "projectInitializedVerified",
            "temporaryProjectVerified",
            "currentSceneDataNonNull",
            "generatedLccAssetPresent",
            "generatedLccAssetPath",
            "generatedLccAssetResolvedPath",
            "generatedLccAssetPathVerified",
            "defaultSceneLoadAccepted",
            "rendererHandlerNonNull",
            "rendererHandlerPath",
            "rendererHandlerPathVerified",
            "canonicalSceneLoadedVerified",
            "renderAllBeginEventTopic",
            "renderAllBeginEventSubscriptionAccepted",
            "renderAllBeginEventObserved",
            "renderAllPendingDefaultDerivedFromFreshRenderer",
            "renderAllPendingTrueRequestedBeforeLoad",
            "renderAllActiveTrueObservedAfterLoad",
            "renderAllPendingFalseResetAttempted",
            "renderAllPendingFalseResetCallCompleted",
            "renderAllPendingResetReadbackAvailable",
            "renderAllIsolationBoundary"
        })
        {
            if (!fields.Contains(expected))
            {
                throw new InvalidOperationException("Scene-load receipt field is missing: " + expected);
            }
        }
        foreach (string forbidden in new[]
        {
            "callbackObserved",
            "callbackLoadedCanonicalSceneVerified",
            "returnedHandlerNonNull",
            "returnedHandlerPath",
            "returnedHandlerPathVerified"
        })
        {
            if (fields.Contains(forbidden))
            {
                throw new InvalidOperationException("Obsolete direct-load receipt field remains: " + forbidden);
            }
        }
    }

    private static void TestNativeRenderModeContract()
    {
        CapturePolicy.RequireUltraQuality(true);
        CapturePolicy.RequireObservedUltraRenderAll(true, true);
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireUltraQuality(false);
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireObservedUltraRenderAll(false, true);
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireObservedUltraRenderAll(true, false);
        });

        var fields = new HashSet<string>(typeof(CaptureReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "vendorFullRenderBudgetPredicate",
            "vendorFullRenderBudgetEligible",
            "vendorFullRenderBudgetEligibilityUsedForAdmission",
            "renderAllRequested",
            "renderAllObservedAfterRequest",
            "renderAllRequestedBeforeSceneLoad",
            "renderAllObservedAfterSceneLoad",
            "renderAllVerifiedAtEveryGate",
            "renderCallbackSurface",
            "globalCameraCallbackRequiredForAdmission",
            "standardCameraRenderCallbackProofAvailable",
            "pipelineAssetType",
            "configuredPixelSource",
            "observedPixelSource",
            "everyObservedPixelSourceMatchesConfigured",
            "perCaptureTimeoutSemantics",
            "perCaptureTimeoutCanPreemptBlockedUnityMainThread",
            "lateResultObserverCompletionAwaitedBeforeProcessExit",
            "hardTerminationBoundary",
            "blackChannelThreshold",
            "minimumNonBlackPixelFraction",
            "minimumMaximumChannelDynamicRange",
            "minimumDistinctRgbCount",
            "minimumLuminanceStandardDeviation",
            "everyAttemptDecodedAndNonDegenerate",
            "urpRendererInventory"
        })
        {
            if (!fields.Contains(expected))
            {
                throw new InvalidOperationException(
                    "Native render-mode receipt field is missing: " + expected);
            }
        }
        if (fields.Contains("fullRenderSupported") ||
            fields.Contains("vendorFullRenderBudgetEligibilityReported") ||
            fields.Contains("exactCameraRenderCallbackRequired"))
        {
            throw new InvalidOperationException(
                "A misleading SupportFullRender receipt field remains.");
        }
    }

    private static void TestReadOnlyUrpRendererInventoryContract()
    {
        var fields = new HashSet<string>(typeof(UrpRendererInventoryReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "observationApi",
            "observationFrame",
            "observationRealtimeSeconds",
            "publicGettersOnly",
            "mutationApiInvoked",
            "prohibitedMutationApis",
            "currentRenderPipelineAssetPresent",
            "currentRenderPipelineAssetTypeFullName",
            "currentRenderPipelineAssetIsUniversal",
            "rendererDataCount",
            "rendererInstanceCount",
            "rendererData",
            "rendererInstances",
            "snapFrameCaptureFeatureCount",
            "activeSnapFrameCaptureFeatureCount",
            "snapFrameStaticInstancePresent",
            "snapFrameStaticInstanceId",
            "snapFrameStaticInstanceTypeFullName",
            "snapFrameStaticInstanceMatchedConfiguredFeatureCount",
            "snapFrameStaticInstanceStableDuringSynchronousInventory",
            "sceneCameraRendererIndexInferred",
            "sceneCameraRendererIndex",
            "sceneCameraRendererIndexProvenance",
            "rendererObjectIdentityStableDuringSynchronousInventory",
            "rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory",
            "mutationObservedDuringSynchronousInventory"
        })
        {
            if (!fields.Contains(expected))
            {
                throw new InvalidOperationException(
                    "URP renderer-inventory receipt field is missing: " + expected);
            }
        }

        UrpRendererInventoryReceipt valid = CreateValidUrpRendererInventory();
        CapturePolicy.RequireReadOnlyUrpRendererInventory(valid);

        UrpRendererInventoryReceipt missingSnapFrame = CreateValidUrpRendererInventory();
        missingSnapFrame.rendererData[0].features.Clear();
        missingSnapFrame.rendererData[0].featureCount = 0;
        missingSnapFrame.rendererData[0].snapFrameCaptureFeatureCount = 0;
        missingSnapFrame.snapFrameCaptureFeatureCount = 0;
        missingSnapFrame.snapFrameStaticInstancePresent = false;
        missingSnapFrame.snapFrameStaticInstanceId = 0;
        missingSnapFrame.snapFrameStaticInstanceTypeFullName = null;
        missingSnapFrame.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        CapturePolicy.RequireReadOnlyUrpRendererInventory(missingSnapFrame);

        UrpRendererInventoryReceipt configuredWithoutSingleton =
            CreateValidUrpRendererInventory();
        configuredWithoutSingleton.rendererData[0].features[0]
            .matchesSnapFrameStaticInstance = false;
        configuredWithoutSingleton.snapFrameStaticInstancePresent = false;
        configuredWithoutSingleton.snapFrameStaticInstanceId = 0;
        configuredWithoutSingleton.snapFrameStaticInstanceTypeFullName = null;
        configuredWithoutSingleton.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        CapturePolicy.RequireReadOnlyUrpRendererInventory(configuredWithoutSingleton);

        UrpRendererInventoryReceipt singletonOutsideConfiguredList =
            CreateValidUrpRendererInventory();
        singletonOutsideConfiguredList.rendererData[0].features[0]
            .matchesSnapFrameStaticInstance = false;
        singletonOutsideConfiguredList.snapFrameStaticInstanceId = 99;
        singletonOutsideConfiguredList.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        CapturePolicy.RequireReadOnlyUrpRendererInventory(singletonOutsideConfiguredList);

        UrpRendererInventoryReceipt blankNames = CreateValidUrpRendererInventory();
        blankNames.currentRenderPipelineAssetName = String.Empty;
        blankNames.rendererData[0].name = String.Empty;
        blankNames.rendererData[0].features[0].name = String.Empty;
        CapturePolicy.RequireReadOnlyUrpRendererInventory(blankNames);

        UrpRendererInventoryReceipt nullSlots = CreateValidUrpRendererInventory();
        nullSlots.rendererData[0].present = false;
        nullSlots.rendererData[0].name = null;
        nullSlots.rendererData[0].typeFullName = null;
        nullSlots.rendererData[0].instanceId = 0;
        nullSlots.rendererData[0].features.Clear();
        nullSlots.rendererData[0].featureCount = 0;
        nullSlots.rendererData[0].snapFrameCaptureFeatureCount = 0;
        nullSlots.rendererInstances[0].present = false;
        nullSlots.rendererInstances[0].typeFullName = null;
        nullSlots.rendererInstances[0].runtimeIdentityHashCode = 0;
        nullSlots.snapFrameCaptureFeatureCount = 0;
        nullSlots.snapFrameStaticInstancePresent = false;
        nullSlots.snapFrameStaticInstanceId = 0;
        nullSlots.snapFrameStaticInstanceTypeFullName = null;
        nullSlots.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        nullSlots.sceneCameraRendererIndexInferred = false;
        nullSlots.sceneCameraRendererIndex = -1;
        nullSlots.sceneCameraRendererIndexProvenance =
            "unavailable_without_a_public_side_effect_free_renderer_index_getter";
        CapturePolicy.RequireReadOnlyUrpRendererInventory(nullSlots);

        UrpRendererInventoryReceipt lazyRendererArray =
            CreateValidUrpRendererInventory();
        lazyRendererArray.rendererDataCount = 2;
        lazyRendererArray.rendererInstanceCount = 1;
        lazyRendererArray.rendererDataAndInstanceCountsMatch = false;
        lazyRendererArray.rendererData.Add(new UrpRendererDataReceipt
        {
            rendererDataIndex = 1,
            present = false,
            features = new List<UrpRendererFeatureReceipt>()
        });
        lazyRendererArray.rendererInstances[0].present = false;
        lazyRendererArray.rendererInstances[0].typeFullName = null;
        lazyRendererArray.rendererInstances[0].runtimeIdentityHashCode = 0;
        lazyRendererArray.rendererData[0].features[0]
            .matchesSnapFrameStaticInstance = false;
        lazyRendererArray.snapFrameStaticInstancePresent = false;
        lazyRendererArray.snapFrameStaticInstanceId = 0;
        lazyRendererArray.snapFrameStaticInstanceTypeFullName = null;
        lazyRendererArray.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        lazyRendererArray.sceneCameraRendererIndexInferred = false;
        lazyRendererArray.sceneCameraRendererIndex = -1;
        lazyRendererArray.sceneCameraRendererIndexProvenance =
            "unavailable_without_a_public_side_effect_free_renderer_index_getter";
        CapturePolicy.RequireReadOnlyUrpRendererInventory(lazyRendererArray);

        UrpRendererInventoryReceipt nonPublic = CreateValidUrpRendererInventory();
        nonPublic.publicGettersOnly = false;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(nonPublic);
        });
        UrpRendererInventoryReceipt mutated = CreateValidUrpRendererInventory();
        mutated.mutationApiInvoked = true;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(mutated);
        });
        UrpRendererInventoryReceipt unstable = CreateValidUrpRendererInventory();
        unstable.rendererObjectIdentityStableDuringSynchronousInventory = false;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(unstable);
        });
        UrpRendererInventoryReceipt featureDrift = CreateValidUrpRendererInventory();
        featureDrift.rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory = false;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(featureDrift);
        });
        UrpRendererInventoryReceipt observedMutation = CreateValidUrpRendererInventory();
        observedMutation.mutationObservedDuringSynchronousInventory = true;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(observedMutation);
        });
        UrpRendererInventoryReceipt countMismatch = CreateValidUrpRendererInventory();
        countMismatch.snapFrameCaptureFeatureCount = 0;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(countMismatch);
        });
        UrpRendererInventoryReceipt forgedSingletonMatch =
            CreateValidUrpRendererInventory();
        forgedSingletonMatch.snapFrameStaticInstanceId = 99;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(forgedSingletonMatch);
        });
        UrpRendererInventoryReceipt suppressedSingletonMatch =
            CreateValidUrpRendererInventory();
        suppressedSingletonMatch.rendererData[0].features[0]
            .matchesSnapFrameStaticInstance = false;
        suppressedSingletonMatch.snapFrameStaticInstanceMatchedConfiguredFeatureCount = 0;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(
                suppressedSingletonMatch);
        });
        UrpRendererInventoryReceipt forgedTypeFlag = CreateValidUrpRendererInventory();
        forgedTypeFlag.rendererData[0].features[0].snapFrameCaptureFeatureType = false;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(forgedTypeFlag);
        });
        UrpRendererInventoryReceipt duplicateIndex = CreateValidUrpRendererInventory();
        duplicateIndex.rendererData[0].rendererDataIndex = 1;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(duplicateIndex);
        });
        UrpRendererInventoryReceipt prohibitedApiDrift = CreateValidUrpRendererInventory();
        prohibitedApiDrift.prohibitedMutationApis[0] =
            "UniversalRenderPipelineAsset.scriptableRenderer";
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(prohibitedApiDrift);
        });
        UrpRendererInventoryReceipt falseCountEquality =
            CreateValidUrpRendererInventory();
        falseCountEquality.rendererInstanceCount = 0;
        falseCountEquality.rendererInstances.Clear();
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(falseCountEquality);
        });
        UrpRendererInventoryReceipt unresolvedSoleRenderer = CreateValidUrpRendererInventory();
        unresolvedSoleRenderer.sceneCameraRendererIndexInferred = false;
        unresolvedSoleRenderer.sceneCameraRendererIndex = -1;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(unresolvedSoleRenderer);
        });
        UrpRendererInventoryReceipt forgedInferredProvenance =
            CreateValidUrpRendererInventory();
        forgedInferredProvenance.sceneCameraRendererIndexProvenance =
            "observed_camera_binding";
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(
                forgedInferredProvenance);
        });
        UrpRendererInventoryReceipt forgedUnresolvedProvenance =
            CreateValidUrpRendererInventory();
        forgedUnresolvedProvenance.rendererDataCount = 2;
        forgedUnresolvedProvenance.rendererDataAndInstanceCountsMatch = false;
        forgedUnresolvedProvenance.rendererData.Add(new UrpRendererDataReceipt
        {
            rendererDataIndex = 1,
            present = false,
            features = new List<UrpRendererFeatureReceipt>()
        });
        forgedUnresolvedProvenance.sceneCameraRendererIndexInferred = false;
        forgedUnresolvedProvenance.sceneCameraRendererIndex = -1;
        forgedUnresolvedProvenance.sceneCameraRendererIndexProvenance =
            "sole_renderer_data_and_instance_entry";
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(
                forgedUnresolvedProvenance);
        });
        UrpRendererInventoryReceipt negativeFrame = CreateValidUrpRendererInventory();
        negativeFrame.observationFrame = -1;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(negativeFrame);
        });
        UrpRendererInventoryReceipt nonFiniteRealtime =
            CreateValidUrpRendererInventory();
        nonFiniteRealtime.observationRealtimeSeconds = Double.NaN;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(nonFiniteRealtime);
        });
        UrpRendererInventoryReceipt infiniteRealtime =
            CreateValidUrpRendererInventory();
        infiniteRealtime.observationRealtimeSeconds = Double.PositiveInfinity;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(infiniteRealtime);
        });
        UrpRendererInventoryReceipt negativeRealtime =
            CreateValidUrpRendererInventory();
        negativeRealtime.observationRealtimeSeconds = -0.01;
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireReadOnlyUrpRendererInventory(negativeRealtime);
        });
    }

    private static UrpRendererInventoryReceipt CreateValidUrpRendererInventory()
    {
        return new UrpRendererInventoryReceipt
        {
            observationApi =
                "GraphicsSettings.currentRenderPipeline + UniversalRenderPipelineAsset.rendererDataList/renderers + ScriptableRendererData.rendererFeatures",
            publicGettersOnly = true,
            mutationApiInvoked = false,
            prohibitedMutationApis = new[]
            {
                "UniversalRenderPipelineAsset.GetRenderer",
                "UniversalRenderPipelineAsset.scriptableRenderer",
                "UniversalAdditionalCameraData.scriptableRenderer",
                "UniversalAdditionalCameraData.SetRenderer",
                "ScriptableRendererData.SetDirty",
                "ScriptableRendererFeature.SetActive"
            },
            currentRenderPipelineAssetPresent = true,
            currentRenderPipelineAssetName = "URP asset",
            currentRenderPipelineAssetTypeFullName =
                "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset",
            currentRenderPipelineAssetInstanceId = 10,
            currentRenderPipelineAssetIsUniversal = true,
            universalAdditionalCameraDataPresent = true,
            rendererDataCount = 1,
            rendererInstanceCount = 1,
            rendererDataAndInstanceCountsMatch = true,
            rendererData = new List<UrpRendererDataReceipt>
            {
                new UrpRendererDataReceipt
                {
                    rendererDataIndex = 0,
                    present = true,
                    name = "UniversalRendererData",
                    typeFullName =
                        "UnityEngine.Rendering.Universal.UniversalRendererData",
                    instanceId = 11,
                    useNativeRenderPass = false,
                    featureCount = 1,
                    snapFrameCaptureFeatureCount = 1,
                    features = new List<UrpRendererFeatureReceipt>
                    {
                        new UrpRendererFeatureReceipt
                        {
                            featureIndex = 0,
                            present = true,
                            name = "SnapFrameCaptureFeature",
                            typeFullName = CapturePolicy.SnapFrameFeatureTypeFullName,
                            instanceId = 12,
                            active = false,
                            snapFrameCaptureFeatureType = true,
                            matchesSnapFrameStaticInstance = true
                        }
                    }
                }
            },
            rendererInstances = new List<UrpRendererInstanceReceipt>
            {
                new UrpRendererInstanceReceipt
                {
                    rendererIndex = 0,
                    present = true,
                    typeFullName =
                        "UnityEngine.Rendering.Universal.UniversalRenderer",
                    runtimeIdentityHashCode = 13
                }
            },
            snapFrameCaptureFeatureCount = 1,
            activeSnapFrameCaptureFeatureCount = 0,
            snapFrameStaticInstancePresent = true,
            snapFrameStaticInstanceId = 12,
            snapFrameStaticInstanceTypeFullName =
                CapturePolicy.SnapFrameFeatureTypeFullName,
            snapFrameStaticInstanceMatchedConfiguredFeatureCount = 1,
            snapFrameStaticInstanceStableDuringSynchronousInventory = true,
            sceneCameraRendererIndexInferred = true,
            sceneCameraRendererIndex = 0,
            sceneCameraRendererIndexProvenance =
                "sole_renderer_data_and_instance_entry",
            rendererObjectIdentityStableDuringSynchronousInventory = true,
            rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory = true,
            mutationObservedDuringSynchronousInventory = false
        };
    }

    private static void TestSnapFrameCaptureRoutePolicy()
    {
        AssertEqual(
            0.05,
            CapturePolicy.SnapFrameSentinelTranslationMetres,
            "SnapFrame sentinel translation metres");
        SnapFrameSurfaceReceipt valid = CreateValidSnapFrameSurfaceReceipt();
        CapturePolicy.RequireSnapFrameCaptureRoute(valid, CapturePolicy.SnapFramePixelSource);

        SnapFrameSurfaceReceipt nonNullActive = CreateValidSnapFrameSurfaceReceipt();
        nonNullActive.readback.renderTextureActiveWasNullBeforeReadback = false;
        nonNullActive.readback.renderTextureActiveBeforeReadbackInstanceId = 701;
        nonNullActive.readback.renderTextureActiveWasNullAfterReadback = false;
        nonNullActive.readback.renderTextureActiveAfterReadbackInstanceId = 701;
        CapturePolicy.RequireSnapFrameCaptureRoute(
            nonNullActive,
            CapturePolicy.SnapFramePixelSource);

        SnapFrameSurfaceReceipt reverifiedRaster = CreateValidSnapFrameSurfaceReceipt();
        reverifiedRaster.sentinelRaster.nonDegenerateVerified = false;
        CapturePolicy.RequireSnapFrameCaptureRoute(
            reverifiedRaster,
            CapturePolicy.SnapFramePixelSource);
        AssertEqual(
            true,
            reverifiedRaster.sentinelRaster.nonDegenerateVerified,
            "SnapFrame sentinel raster re-verification");

        SnapFrameSurfaceReceipt boundSurface = CreateValidSnapFrameSurfaceReceipt();
        RasterStatisticsReceipt boundRaster = boundSurface.sentinelRaster;
        boundRaster.rgb24Sha256 = boundSurface.exactFrameRgb24Sha256;
        CapturePolicy.RequireSnapFrameExactRasterBinding(boundSurface, boundRaster);
        ExpectThrows<InvalidOperationException>(delegate
        {
            SnapFrameSurfaceReceipt mismatchedSurface = CreateValidSnapFrameSurfaceReceipt();
            CapturePolicy.RequireSnapFrameExactRasterBinding(
                mismatchedSurface,
                mismatchedSurface.sentinelRaster);
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireSnapFrameExactRasterBinding(null, boundRaster);
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireSnapFrameExactRasterBinding(boundSurface, null);
        });
        ExpectThrows<InvalidDataException>(delegate
        {
            SnapFrameSurfaceReceipt degenerateSentinel = CreateValidSnapFrameSurfaceReceipt();
            degenerateSentinel.sentinelRaster.luminanceStandardDeviation = 0.0;
            CapturePolicy.RequireSnapFrameCaptureRoute(
                degenerateSentinel,
                CapturePolicy.SnapFramePixelSource);
        });
        ExpectThrows<InvalidDataException>(delegate
        {
            SnapFrameSurfaceReceipt nonFiniteSentinel = CreateValidSnapFrameSurfaceReceipt();
            nonFiniteSentinel.sentinelRaster.nonBlackPixelFraction = Double.NaN;
            CapturePolicy.RequireSnapFrameCaptureRoute(
                nonFiniteSentinel,
                CapturePolicy.SnapFramePixelSource);
        });

        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireSnapFrameCaptureRoute(null, CapturePolicy.SnapFramePixelSource);
        });
        int invalidationIndex = 0;
        foreach (Action<SnapFrameSurfaceReceipt> invalidate in new Action<SnapFrameSurfaceReceipt>[]
        {
            surface => surface.featurePresent = false,
            surface => surface.featureTypeFullName = "LCCCore.OtherFeature",
            surface => surface.featureInstanceId = 0,
            surface => surface.featureStaticInstanceMatched = false,
            surface => surface.featureBaseActiveBefore = false,
            surface => surface.featureBaseActiveAfter = false,
            surface => surface.sceneCameraLive = false,
            surface => surface.sceneCameraInstanceId = 0,
            surface => surface.featureTargetCameraLiveBefore = false,
            surface => surface.featureTargetCameraInstanceIdBefore += 1,
            surface => surface.featureTargetCameraLiveAtReadback = false,
            surface => surface.featureTargetCameraInstanceIdAtReadback += 1,
            surface => surface.featureTargetCameraLiveAfter = false,
            surface => surface.featureTargetCameraInstanceIdAfter += 1,
            surface => surface.featureTargetUnchanged = false,
            surface => surface.sceneCameraTargetTextureNullBefore = false,
            surface => surface.sceneCameraTargetTextureNullAfterDirtyRequest = false,
            surface => surface.sceneCameraTargetTextureNullBeforeReadback = false,
            surface => surface.sceneCameraTargetTextureNullAfter = false,
            surface => surface.captureViewAbsentBefore = false,
            surface => surface.captureViewAbsentAfterDirtyRequest = false,
            surface => surface.captureViewAbsentBeforeReadback = false,
            surface => surface.captureViewAbsentAfter = false,
            surface => surface.knownActiveCaptureOverlayCount = 1,
            surface => surface.knownActiveCaptureOverlayNames = new[] { "CaptureView" },
            surface => surface.knownActiveCaptureOverlayNames = null,
            surface => surface.activeCanvases = null,
            surface => surface.activeCanvases.Add(new SnapFrameCanvasReceipt
            {
                canRenderThroughSceneCamera = true
            }),
            surface => surface.unsafeRenderThroughCanvasObserved = true,
            surface => surface.cleanViewStateVerifiedAtEveryCheckpoint = false,
            surface => surface.graphicsDeviceType = null,
            surface => surface.activeColorSpace = null,
            surface => surface.readPixelsCoordinateOrigin = "upper_left",
            surface => surface.cpuRowTransform = "vertical_flip",
            surface => surface.sceneCameraPixelWidth -= 1,
            surface => surface.sceneCameraPixelHeight -= 1,
            surface => surface.screenWidth -= 1,
            surface => surface.screenHeight -= 1,
            surface => surface.sceneCameraCullingMaskAfter ^= 1,
            surface => surface.sceneCameraTargetDisplayAfter += 1,
            surface => surface.cameraConfigurationUnchanged = false,
            surface => surface.sceneCameraRect[2] = 0.5f,
            surface => surface.sceneCameraRect[0] = Single.NaN,
            surface => surface.sceneCameraRectAfter[3] = 0.5f,
            surface => surface.sceneCameraPixelRect[2] -= 1.0f,
            surface => surface.sceneCameraPixelRectAfter[3] -= 1.0f,
            surface => surface.universalAdditionalCameraDataPresent = false,
            surface => surface.universalCameraRenderType = "Overlay",
            surface => surface.universalCameraStackCount = 1,
            surface => surface.frameSurfaceProvenance = "final_framebuffer",
            surface => surface.frameRenderTextureBefore = null,
            surface => surface.frameRenderTextureAfterDirtyRequest = null,
            surface => surface.frameRenderTextureBeforeReadback = null,
            surface => surface.frameRenderTextureAfter = null,
            surface => surface.frameRenderTextureBefore.observationFrame = -1,
            surface => surface.frameRenderTextureBefore.instanceId = 0,
            surface => surface.frameRenderTextureBefore.isLive = false,
            surface => surface.frameRenderTextureBefore.isCreated = false,
            surface => surface.frameRenderTextureBefore.width -= 1,
            surface => surface.frameRenderTextureBefore.height -= 1,
            surface => surface.frameRenderTextureBefore.depth = 1,
            surface => surface.frameRenderTextureBefore.antiAliasing = 2,
            surface => surface.frameRenderTextureBefore.colorFormat = "DefaultHDR",
            surface => surface.frameRenderTextureBefore.graphicsFormat = null,
            surface => surface.frameRenderTextureBefore.useMipMap = true,
            surface => surface.frameRenderTextureBefore.autoGenerateMips = true,
            surface => surface.frameRenderTextureAfterDirtyRequest.instanceId += 1,
            surface => surface.frameRenderTextureBeforeReadback.instanceId += 1,
            surface => surface.frameRenderTextureAfter.instanceId += 1,
            surface => surface.frameRenderTextureAfterDirtyRequest.graphicsFormat = "B8G8R8A8_UNorm",
            surface => surface.frameRenderTextureAfter.graphicsFormat = "B8G8R8A8_UNorm",
            surface => surface.frameRenderTextureBeforeReadback.sRgb = true,
            surface => surface.frameRenderTextureAfter.sRgb = true,
            surface => surface.frameRenderTextureBefore.observationFrame = 99,
            surface => surface.frameRenderTextureAfterDirtyRequest.observationFrame = 99,
            surface => surface.frameRenderTextureBeforeReadback.observationFrame = 100,
            surface => surface.frameRenderTextureAfter.observationFrame = 101,
            surface => surface.dirtyBeforeRequest = null,
            surface => surface.dirtyAfterRequest = null,
            surface => surface.dirtyBeforeReadback = null,
            surface => surface.dirtyAfterCompletion = null,
            surface => surface.dirtyBeforeRequest.observationFrame = -1,
            surface => surface.dirtyBeforeRequest.dirty = true,
            surface => surface.dirtyAfterRequest.dirty = false,
            surface => surface.dirtyBeforeReadback.dirty = false,
            surface => surface.dirtyAfterCompletion.dirty = true,
            surface => surface.dirtyAfterRequest.observationFrame = 100,
            surface => surface.dirtyBeforeReadback.observationFrame = 101,
            surface => surface.dirtyAfterCompletion.observationFrame = 102,
            surface => surface.sentinelPoseReached = false,
            surface => surface.exactPositionAfter[0] += 0.1,
            surface => surface.exactPositionAfter[0] = Double.NaN,
            surface => surface.exactRotationXyzwAfter[0] += 0.1,
            surface => surface.exactWorldToCameraMatrixColumnMajorAfter[0] += 0.1,
            surface => surface.exactProjectionMatrixColumnMajorAfter[0] += 0.1,
            surface => surface.sentinelPosition = (double[])surface.exactPositionBefore.Clone(),
            surface => surface.sentinelPosition[0] =
                surface.exactPositionBefore[0] + 0.06,
            surface => surface.sentinelRotationXyzw[0] += 0.1,
            surface => surface.sentinelWorldToCameraMatrixColumnMajor[0] += 0.1,
            surface => surface.exactRestoreVerified = false,
            surface => surface.cameraCallbackSubscriptionRemoved = false,
            surface => surface.beginCameraRenderingCallbackCount = 3,
            surface => surface.endCameraRenderingCallbackCount = 3,
            surface => surface.callbackHistoryOverflowed = true,
            surface => surface.everyCameraCallbackMatchedStagePose = false,
            surface => surface.baselineExactEndCallbackVerified = false,
            surface => surface.sentinelEndCallbackVerified = false,
            surface => surface.restoredExactEndCallbackVerified = false,
            surface => surface.stableExactEndCallbackVerified = false,
            surface => surface.cameraCallbacks = null,
            surface => surface.cameraCallbacks[0].sequence = 9,
            surface =>
            {
                surface.cameraCallbacks[0].callback = "end";
                surface.cameraCallbacks[1].callback = "begin";
            },
            surface => surface.cameraCallbacks[0].callback = "other",
            surface => surface.cameraCallbacks[0].stage = "other",
            surface => surface.cameraCallbacks[0].realtimeSeconds = Double.NaN,
            surface => surface.cameraCallbacks[0].cameraMatchesExactSceneCamera = false,
            surface => surface.cameraCallbacks[0].targetTextureNull = false,
            surface => surface.cameraCallbacks[0].poseMatchesStage = false,
            surface => surface.cameraCallbacks[0].projectionMatchesExactProfile = false,
            surface => surface.cameraCallbacks[0].position[0] = Double.NaN,
            surface => surface.cameraCallbacks[0].frameRenderTextureInstanceId += 1,
            surface => surface.sentinelReadback = null,
            surface => surface.sentinelReadback.firstPartyTextureDistinctFromVendorFrameRenderTexture = false,
            surface => surface.sentinelReadback.vendorFrameRenderTextureDestroyRequested = true,
            surface => surface.sentinelRaster = null,
            surface => surface.exactFrameRgb24Sha256 = null,
            surface => surface.sentinelAndExactRgbDiffer = false,
            surface => surface.exactFrameRgb24Sha256 = surface.sentinelRaster.rgb24Sha256,
            surface => surface.readback = null,
            surface => surface.readback.renderTextureActiveBeforeReadbackInstanceId = 1,
            surface =>
            {
                surface.readback.renderTextureActiveWasNullBeforeReadback = false;
                surface.readback.renderTextureActiveBeforeReadbackInstanceId = 0;
                surface.readback.renderTextureActiveWasNullAfterReadback = false;
            },
            surface => surface.readback.renderTextureActiveBoundForReadbackInstanceId += 1,
            surface => surface.readback.activeFrameRenderTextureVerifiedBeforeReadPixels = false,
            surface => surface.readback.firstPartyReadPixelsCompleted = false,
            surface => surface.readback.firstPartyApplyCompleted = false,
            surface => surface.readback.renderTextureActiveWasNullAfterReadback = false,
            surface => surface.readback.renderTextureActiveAfterReadbackInstanceId = 1,
            surface => surface.readback.renderTextureActiveRestored = false,
            surface => surface.readback.firstPartyTextureInstanceId = 0,
            surface => surface.readback.firstPartyTextureFormat = "RGBA32",
            surface => surface.readback.firstPartyTextureReadable = false,
            surface => surface.readback.firstPartyTextureNoMipChain = false,
            surface => surface.readback.firstPartyTextureDistinctFromVendorFrameRenderTexture = false,
            surface => surface.readback.vendorFrameRenderTextureDestroyRequested = true
        })
        {
            invalidationIndex += 1;
            SnapFrameSurfaceReceipt invalid = CreateValidSnapFrameSurfaceReceipt();
            invalidate(invalid);
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireSnapFrameCaptureRoute(
                    invalid,
                    CapturePolicy.SnapFramePixelSource);
            }, "SnapFrame adversarial mutation #" +
                invalidationIndex.ToString(CultureInfo.InvariantCulture));
        }
        foreach (string invalidPixelSource in new[]
        {
            null,
            String.Empty,
            "first_party_exact_vendor_render_target",
            "FIRST_PARTY_LCC_SNAP_FRAME_RENDER_TARGET"
        })
        {
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireSnapFrameCaptureRoute(
                    CreateValidSnapFrameSurfaceReceipt(),
                    invalidPixelSource);
            });
        }

        var attemptFields = new HashSet<string>(typeof(CaptureAttemptReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        if (!attemptFields.Contains("snapFrameSurface"))
        {
            throw new InvalidOperationException(
                "Capture-attempt SnapFrame surface receipt field is missing.");
        }
    }

    private static SnapFrameSurfaceReceipt CreateValidSnapFrameSurfaceReceipt()
    {
        const int featureInstanceId = -101;
        const int sceneCameraInstanceId = -202;
        const int frameRenderTextureInstanceId = -303;
        return new SnapFrameSurfaceReceipt
        {
            featurePresent = true,
            featureTypeFullName = CapturePolicy.SnapFrameFeatureTypeFullName,
            featureInstanceId = featureInstanceId,
            featureStaticInstanceMatched = true,
            featureBaseActiveBefore = true,
            featureBaseActiveAfter = true,
            sceneCameraLive = true,
            sceneCameraInstanceId = sceneCameraInstanceId,
            featureTargetCameraLiveBefore = true,
            featureTargetCameraInstanceIdBefore = sceneCameraInstanceId,
            featureTargetCameraLiveAtReadback = true,
            featureTargetCameraInstanceIdAtReadback = sceneCameraInstanceId,
            featureTargetCameraLiveAfter = true,
            featureTargetCameraInstanceIdAfter = sceneCameraInstanceId,
            featureTargetUnchanged = true,
            sceneCameraTargetTextureNullBefore = true,
            sceneCameraTargetTextureNullAfterDirtyRequest = true,
            sceneCameraTargetTextureNullBeforeReadback = true,
            sceneCameraTargetTextureNullAfter = true,
            captureViewAbsentBefore = true,
            captureViewAbsentAfterDirtyRequest = true,
            captureViewAbsentBeforeReadback = true,
            captureViewAbsentAfter = true,
            knownActiveCaptureOverlayCount = 0,
            knownActiveCaptureOverlayNames = new string[0],
            activeCanvases = new List<SnapFrameCanvasReceipt>(),
            unsafeRenderThroughCanvasObserved = false,
            graphicsDeviceType = "Direct3D12",
            graphicsUvStartsAtTop = true,
            activeColorSpace = "Linear",
            readPixelsCoordinateOrigin = CapturePolicy.SnapFrameReadPixelsCoordinateOrigin,
            cpuRowTransform = CapturePolicy.SnapFrameCpuRowTransform,
            sceneCameraPixelWidth = CapturePolicy.CaptureWidth,
            sceneCameraPixelHeight = CapturePolicy.CaptureHeight,
            screenWidth = CapturePolicy.CaptureWidth,
            screenHeight = CapturePolicy.CaptureHeight,
            sceneCameraCullingMask = -1,
            sceneCameraCullingMaskAfter = -1,
            sceneCameraTargetDisplay = 0,
            sceneCameraTargetDisplayAfter = 0,
            sceneCameraRect = new[] { 0.0f, 0.0f, 1.0f, 1.0f },
            sceneCameraRectAfter = new[] { 0.0f, 0.0f, 1.0f, 1.0f },
            sceneCameraPixelRect = new[]
            {
                0.0f,
                0.0f,
                (float)CapturePolicy.CaptureWidth,
                (float)CapturePolicy.CaptureHeight
            },
            sceneCameraPixelRectAfter = new[]
            {
                0.0f,
                0.0f,
                (float)CapturePolicy.CaptureWidth,
                (float)CapturePolicy.CaptureHeight
            },
            cameraConfigurationUnchanged = true,
            cleanViewStateVerifiedAtEveryCheckpoint = true,
            universalAdditionalCameraDataPresent = true,
            universalCameraRenderType = "Base",
            universalCameraStackCount = 0,
            universalRenderPostProcessing = false,
            frameSurfaceProvenance = CapturePolicy.SnapFrameSurfaceProvenance,
            frameRenderTextureBefore = CreateValidSnapFrameObservation(
                100,
                frameRenderTextureInstanceId),
            frameRenderTextureAfterDirtyRequest = CreateValidSnapFrameObservation(
                101,
                frameRenderTextureInstanceId),
            frameRenderTextureBeforeReadback = CreateValidSnapFrameObservation(
                102,
                frameRenderTextureInstanceId),
            frameRenderTextureAfter = CreateValidSnapFrameObservation(
                103,
                frameRenderTextureInstanceId),
            dirtyBeforeRequest = new SnapFrameDirtyObservationReceipt
            {
                observationFrame = 100,
                dirty = false
            },
            dirtyAfterRequest = new SnapFrameDirtyObservationReceipt
            {
                observationFrame = 101,
                dirty = true
            },
            dirtyBeforeReadback = new SnapFrameDirtyObservationReceipt
            {
                observationFrame = 102,
                dirty = true
            },
            dirtyAfterCompletion = new SnapFrameDirtyObservationReceipt
            {
                observationFrame = 103,
                dirty = false
            },
            exactPositionBefore = new[] { 1.0, 2.0, 3.0 },
            exactRotationXyzwBefore = new[] { 0.0, 0.0, 0.0, 1.0 },
            exactWorldToCameraMatrixColumnMajorBefore = IdentityMatrix(),
            exactProjectionMatrixColumnMajorBefore = IdentityMatrix(),
            sentinelPosition = new[] { 1.05, 2.0, 3.0 },
            sentinelRotationXyzw = new[] { 0.0, 0.0, 0.0, 1.0 },
            sentinelWorldToCameraMatrixColumnMajor = IdentityMatrix(),
            exactPositionAfter = new[] { 1.0, 2.0, 3.0 },
            exactRotationXyzwAfter = new[] { 0.0, 0.0, 0.0, 1.0 },
            exactWorldToCameraMatrixColumnMajorAfter = IdentityMatrix(),
            exactProjectionMatrixColumnMajorAfter = IdentityMatrix(),
            sentinelPoseReached = true,
            sentinelReadback = CreateValidSnapFrameReadback(
                frameRenderTextureInstanceId,
                -405),
            sentinelRaster = new RasterStatisticsReceipt
            {
                pixelCount = (long)CapturePolicy.CaptureWidth * CapturePolicy.CaptureHeight,
                nonBlackPixelCount = 1000000,
                nonBlackPixelFraction = 1000000.0 /
                    (CapturePolicy.CaptureWidth * CapturePolicy.CaptureHeight),
                minimumRed = 0,
                maximumRed = 255,
                minimumGreen = 0,
                maximumGreen = 255,
                minimumBlue = 0,
                maximumBlue = 255,
                maximumChannelDynamicRange = 255,
                distinctRgbLowerBound = 1024,
                distinctRgbCountCapped = false,
                meanLuminance = 100.0,
                luminanceStandardDeviation = 20.0,
                rgb24Sha256 = new string('A', 64),
                nonDegenerateVerified = true
            },
            exactFrameRgb24Sha256 = new string('B', 64),
            sentinelAndExactRgbDiffer = true,
            exactRestoreVerified = true,
            cameraCallbackSubscriptionRemoved = true,
            beginCameraRenderingCallbackCount = 4,
            endCameraRenderingCallbackCount = 4,
            callbackHistoryOverflowed = false,
            everyCameraCallbackMatchedStagePose = true,
            baselineExactEndCallbackVerified = true,
            sentinelEndCallbackVerified = true,
            restoredExactEndCallbackVerified = true,
            stableExactEndCallbackVerified = true,
            cameraCallbacks = CreateValidSnapFrameCallbacks(
                sceneCameraInstanceId,
                frameRenderTextureInstanceId),
            readback = CreateValidSnapFrameReadback(
                frameRenderTextureInstanceId,
                -404)
        };
    }

    private static SnapFrameRenderTextureObservationReceipt CreateValidSnapFrameObservation(
        int frame,
        int instanceId)
    {
        return new SnapFrameRenderTextureObservationReceipt
        {
            observationFrame = frame,
            instanceId = instanceId,
            isLive = true,
            isCreated = true,
            width = CapturePolicy.CaptureWidth,
            height = CapturePolicy.CaptureHeight,
            depth = 0,
            antiAliasing = 1,
            colorFormat = "ARGB32",
            graphicsFormat = "R8G8B8A8_UNorm",
            sRgb = false,
            useMipMap = false,
            autoGenerateMips = false
        };
    }

    private static SnapFrameReadbackReceipt CreateValidSnapFrameReadback(
        int frameRenderTextureInstanceId,
        int textureInstanceId)
    {
        return new SnapFrameReadbackReceipt
        {
            renderTextureActiveWasNullBeforeReadback = true,
            renderTextureActiveBeforeReadbackInstanceId = 0,
            renderTextureActiveBoundForReadbackInstanceId = frameRenderTextureInstanceId,
            activeFrameRenderTextureVerifiedBeforeReadPixels = true,
            firstPartyReadPixelsCompleted = true,
            firstPartyApplyCompleted = true,
            renderTextureActiveWasNullAfterReadback = true,
            renderTextureActiveAfterReadbackInstanceId = 0,
            renderTextureActiveRestored = true,
            firstPartyTextureInstanceId = textureInstanceId,
            firstPartyTextureFormat = "RGB24",
            firstPartyTextureReadable = true,
            firstPartyTextureNoMipChain = true,
            firstPartyTextureDistinctFromVendorFrameRenderTexture = true,
            vendorFrameRenderTextureDestroyRequested = false
        };
    }

    private static List<SnapFrameCameraCallbackReceipt> CreateValidSnapFrameCallbacks(
        int sceneCameraInstanceId,
        int frameRenderTextureInstanceId)
    {
        var result = new List<SnapFrameCameraCallbackReceipt>();
        string[] stages =
        {
            "baseline_exact",
            "sentinel_discard",
            "restored_exact",
            "stable_exact"
        };
        bool[] dirty = { false, true, true, false };
        for (int index = 0; index < stages.Length; index += 1)
        {
            foreach (string callback in new[] { "begin", "end" })
            {
                result.Add(new SnapFrameCameraCallbackReceipt
                {
                    sequence = result.Count + 1,
                    callback = callback,
                    stage = stages[index],
                    frame = 100 + index,
                    realtimeSeconds = 1.0 + index,
                    cameraMatchesExactSceneCamera = sceneCameraInstanceId != 0,
                    targetTextureNull = true,
                    poseMatchesStage = true,
                    projectionMatchesExactProfile = true,
                    frameDirty = dirty[index],
                    frameRenderTextureInstanceId = frameRenderTextureInstanceId,
                    position = index == 1
                        ? new[] { 1.05, 2.0, 3.0 }
                        : new[] { 1.0, 2.0, 3.0 },
                    rotationXyzw = new[] { 0.0, 0.0, 0.0, 1.0 },
                    worldToCameraMatrixColumnMajor = IdentityMatrix(),
                    projectionMatrixColumnMajor = IdentityMatrix()
                });
            }
        }
        return result;
    }

    private static double[] IdentityMatrix()
    {
        return new[]
        {
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        };
    }

    private static void TestSandboxAndReadinessPolicy()
    {
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireApprovedSandboxEditorRoot(
                @"F:\LccStudio\lcceditor",
                @"F:\LccStudio\lcceditor");
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireApprovedSandboxEditorRoot(
                @"C:\arbitrary-editor",
                CapturePolicy.ApprovedSandboxEditorPath);
        });

        if (CapturePolicy.MinimumReadinessFrames < 300 ||
            CapturePolicy.MinimumReadinessSeconds < 15.0 ||
            CapturePolicy.SceneLoadTimeoutSeconds <= 0.0 ||
            CapturePolicy.PerCaptureTimeoutSeconds <= 0.0)
        {
            throw new InvalidOperationException("The conservative readiness/watchdog contract regressed.");
        }

        CapturePolicy.RequirePathWithoutReparsePoints(Path.GetTempPath(), "test temp root");
    }

    private static void TestCanonicalPathGate()
    {
        CapturePolicy.RequireCanonicalScenePath(CapturePolicy.CanonicalScenePath);
        CapturePolicy.RequireCanonicalScenePath(CapturePolicy.CanonicalScenePath.ToLowerInvariant());
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireCanonicalScenePath(
                @"C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_2\lcc2-result\Grand_Hall.lcc2");
        });
    }

    private static void TestNativeCaptureLifecycleState()
    {
        var normal = new NativeCaptureLifecycleState();
        AssertEqual(LifecycleExecutionDecision.NotReady, normal.TryEnterExecution(),
            "Execute before modules.loaded next-frame handoff");
        AssertEqual(true, normal.TryScheduleModulesLoaded(), "first modules.loaded delivery");
        AssertEqual(false, normal.TryScheduleModulesLoaded(), "duplicate modules.loaded delivery");
        AssertEqual(true, normal.TryMarkNextFrameExecutionReady(), "next-frame execution readiness");
        AssertEqual(LifecycleExecutionDecision.Acquired, normal.TryEnterExecution(),
            "first guarded execution");
        AssertEqual(LifecycleExecutionDecision.Duplicate, normal.TryEnterExecution(),
            "duplicate guarded execution");

        var stoppedBeforeLifecycle = new NativeCaptureLifecycleState();
        stoppedBeforeLifecycle.Stop();
        AssertEqual(true, stoppedBeforeLifecycle.IsStopped, "terminal Stop state");
        AssertEqual(false, stoppedBeforeLifecycle.TryScheduleModulesLoaded(),
            "modules.loaded after Stop");
        AssertEqual(false, stoppedBeforeLifecycle.TryMarkNextFrameExecutionReady(),
            "next-frame readiness after Stop");
        AssertEqual(LifecycleExecutionDecision.Stopped, stoppedBeforeLifecycle.TryEnterExecution(),
            "Execute after Stop");

        var stoppedBetweenLifecycleAwaits = new NativeCaptureLifecycleState();
        AssertEqual(true, stoppedBetweenLifecycleAwaits.TryScheduleModulesLoaded(),
            "modules.loaded before first lifecycle await");
        stoppedBetweenLifecycleAwaits.Stop();
        AssertEqual(false, stoppedBetweenLifecycleAwaits.TryMarkNextFrameExecutionReady(),
            "Stop between lifecycle awaits");
        AssertEqual(LifecycleExecutionDecision.Stopped,
            stoppedBetweenLifecycleAwaits.TryEnterExecution(),
            "Execute rejected after Stop between lifecycle awaits");

        var stoppedDuringSceneLoad = new NativeCaptureLifecycleState();
        AssertEqual(true, stoppedDuringSceneLoad.TryScheduleModulesLoaded(),
            "scene-load lifecycle scheduled");
        AssertEqual(true, stoppedDuringSceneLoad.TryMarkNextFrameExecutionReady(),
            "scene-load execution ready");
        AssertEqual(LifecycleExecutionDecision.Acquired, stoppedDuringSceneLoad.TryEnterExecution(),
            "scene-load execution started");
        stoppedDuringSceneLoad.Stop();
        AssertEqual(true, stoppedDuringSceneLoad.IsStopped, "Stop during scene load");
    }

    private static void TestRawCoordinateTransform(FixedCameraProfile profile)
    {
        Vec3d sourcePosition = profile.SourcePosition();
        Vec3d position = CapturePolicy.RawLccSourceToUnity(sourcePosition);
        Vec3d target = CapturePolicy.RawLccSourceToUnity(profile.SourceTarget());
        Vec3d upEnd = CapturePolicy.RawLccSourceToUnity(
            sourcePosition + profile.SourceUp());
        Vec3d up = new Vec3d(
            upEnd.X - position.X,
            upEnd.Y - position.Y,
            upEnd.Z - position.Z);

        CapturePolicy.RequireApproximatelyEqual(
            "position",
            position,
            profile.ExpectedNativePosition(),
            0.000000001);
        CapturePolicy.RequireApproximatelyEqual(
            "target",
            target,
            profile.ExpectedNativeTarget(),
            0.000000001);
        CapturePolicy.RequireApproximatelyEqual(
            "up",
            up,
            profile.ExpectedNativeUp(),
            0.000000001);
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireApproximatelyEqual(
                "wrong position",
                new Vec3d(position.X + 0.1, position.Y, position.Z),
                profile.ExpectedNativePosition(),
                profile.Frames.Native.AssertionTolerance);
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireApproximatelyEqual(
                "non-finite position",
                new Vec3d(Double.NaN, position.Y, position.Z),
                profile.ExpectedNativePosition(),
                profile.Frames.Native.AssertionTolerance);
        });
    }

    private static void TestFixedCameraProfile(FixedCameraProfile profile)
    {
        AssertEqual(CapturePolicy.CameraProfileSha256, profile.Sha256, "camera profile SHA");
        AssertEqual("xgrids_lcc2_source_z_up", profile.Frames.Source.Id, "source frame");
        AssertEqual("xgrids_lcceditor_unity_y_up", profile.Frames.Native.Id, "native frame");
        AssertEqual("venviewer_browser_centered_y_up", profile.Frames.Three.Id, "Three frame");
        AssertEqual(1600, profile.Output.Width, "capture width");
        AssertEqual(900, profile.Output.Height, "capture height");
        AssertEqual(false, profile.Environment.Include, "environment inclusion");
        AssertEqual(false, profile.Environment.VisibilityGetterAvailable, "environment visibility getter");
        ExpectThrows<InvalidOperationException>(delegate
        {
            FixedCameraProfile.Load(profile.Path, new string('0', 64));
        });
    }

    private static void TestShaGate()
    {
        const string sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        AssertEqual(sha.ToUpperInvariant(), CapturePolicy.RequireSha256(sha, "test"), "normalized SHA");
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireSha256("not-a-sha", "test");
        });
    }

    private static void TestOutputPathGate()
    {
        string root = Path.Combine(Path.GetTempPath(), "venviewer-native-capture-policy-" + Guid.NewGuid().ToString("N"));
        string editor = Path.Combine(root, "editor");
        string output = Path.Combine(root, "output");
        string insideEditor = Path.Combine(editor, "evidence");
        Directory.CreateDirectory(editor);
        Directory.CreateDirectory(output);
        Directory.CreateDirectory(insideEditor);

        try
        {
            AssertEqual(
                CapturePolicy.NormalizePath(output),
                CapturePolicy.RequireEmptySafeOutputDirectory(output, editor),
                "safe output path");
            CapturePolicy.RequireTreeWithoutReparsePoints(root, "owned test tree");
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireEmptySafeOutputDirectory(insideEditor, editor);
            });
            File.WriteAllText(Path.Combine(output, "existing.txt"), "evidence");
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireEmptySafeOutputDirectory(output, editor);
            });
            ExpectThrows<DirectoryNotFoundException>(delegate
            {
                CapturePolicy.RequireEmptySafeOutputDirectory(Path.Combine(root, "missing"), editor);
            });
        }
        finally
        {
            DeleteOwnedTempTree(root, "venviewer-native-capture-policy-");
        }
    }

    private static void TestPngDimensionGate()
    {
        string root = Path.Combine(Path.GetTempPath(), "venviewer-native-png-policy-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        string validPath = Path.Combine(root, "valid.png");
        string invalidPath = Path.Combine(root, "invalid.png");

        try
        {
            File.WriteAllBytes(validPath, CreatePngHeader(1600, 900));
            File.WriteAllBytes(invalidPath, CreatePngHeader(800, 600));
            CapturePolicy.RequirePngDimensions(validPath, 1600, 900);
            ExpectThrows<InvalidDataException>(delegate
            {
                CapturePolicy.RequirePngDimensions(invalidPath, 1600, 900);
            });
        }
        finally
        {
            DeleteOwnedTempTree(root, "venviewer-native-png-policy-");
        }
    }

    private static void TestDecodedRasterAdmissionGate()
    {
        const int width = 64;
        const int height = 64;
        var valid = new byte[width * height * 3];
        for (int y = 0; y < height; y += 1)
        {
            for (int x = 0; x < width; x += 1)
            {
                int offset = ((y * width) + x) * 3;
                valid[offset] = (byte)((x * 4) & 255);
                valid[offset + 1] = (byte)((y * 4) & 255);
                valid[offset + 2] = (byte)(((x * 3) + (y * 5)) & 255);
            }
        }

        RasterStatisticsReceipt validStatistics = CapturePolicy.AnalyzeRgb24(valid, width, height);
        CapturePolicy.RequireNonDegenerateRaster(validStatistics, width, height);
        AssertEqual(true, validStatistics.nonDegenerateVerified, "valid raster admission");
        AssertEqual((long)width * height, validStatistics.pixelCount, "valid raster pixel count");
        AssertEqual(CapturePolicy.Sha256Bytes(valid), validStatistics.rgb24Sha256, "valid raster RGB hash");
        if (validStatistics.distinctRgbLowerBound < CapturePolicy.MinimumDistinctRgbCount ||
            validStatistics.maximumChannelDynamicRange < CapturePolicy.MinimumMaximumChannelDynamicRange ||
            validStatistics.luminanceStandardDeviation < CapturePolicy.MinimumLuminanceStandardDeviation)
        {
            throw new InvalidOperationException("The valid synthetic raster did not exercise the admission margin.");
        }

        var black = new byte[width * height * 3];
        RasterStatisticsReceipt blackStatistics = CapturePolicy.AnalyzeRgb24(black, width, height);
        AssertEqual(0L, blackStatistics.nonBlackPixelCount, "black raster non-black count");
        AssertEqual(1, blackStatistics.distinctRgbLowerBound, "black raster distinct RGB count");
        ExpectThrows<InvalidDataException>(delegate
        {
            CapturePolicy.RequireNonDegenerateRaster(blackStatistics, width, height);
        });

        var nearConstant = Enumerable.Repeat((byte)4, width * height * 3).ToArray();
        for (int index = 0; index < 12; index += 1)
        {
            nearConstant[index] = 5;
        }
        RasterStatisticsReceipt nearConstantStatistics =
            CapturePolicy.AnalyzeRgb24(nearConstant, width, height);
        ExpectThrows<InvalidDataException>(delegate
        {
            CapturePolicy.RequireNonDegenerateRaster(nearConstantStatistics, width, height);
        });

        ExpectThrows<InvalidDataException>(delegate
        {
            CapturePolicy.AnalyzeRgb24(new byte[7], 2, 2);
        });
        ExpectThrows<InvalidDataException>(delegate
        {
            CapturePolicy.RequireNonDegenerateRaster(validStatistics, width + 1, height);
        });

        var attemptFields = new HashSet<string>(typeof(CaptureAttemptReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "status",
            "elapsedSeconds",
            "srpEndCameraRenderingCallbackCount",
            "firstSrpEndCameraRenderingFrame",
            "lastSrpEndCameraRenderingFrame",
            "standardCameraRenderCallbackProofAvailable",
            "firstPartyReadPixelsCompleted",
            "firstPartyApplyCompleted",
            "firstPartyTextureInstanceId",
            "firstPartyTextureFormat",
            "firstPartyTextureReadable",
            "firstPartyTextureNoMipChain",
            "snapFrameSurface",
            "pixelSource",
            "readbackTrigger",
            "captureTaskCompletedBeforeDeadline",
            "captureTaskStopObserved",
            "captureTaskTimeoutObserved",
            "underlyingCaptureCancellationAvailable",
            "pixelReadCompleted",
            "raster",
            "pngEncodingCompleted",
            "encodedByteLength",
            "encodedSha256",
            "postWriteFileShaVerified",
            "failureType",
            "failureMessage"
        })
        {
            if (!attemptFields.Contains(expected))
            {
                throw new InvalidOperationException("Capture-attempt evidence field is missing: " + expected);
            }
        }
        foreach (string forbidden in new[]
        {
            "exactCameraRenderCallbackCount",
            "firstExactCameraRenderFrame",
            "lastExactCameraRenderFrame",
            "textureFormat",
            "textureReadable",
            "vendorReturnedTextureDestroyed",
            "beforeRenderCallbackInvoked",
            "activeExactTargetVerifiedBeforeReadPixels",
            "renderTargetAssignedBeforeCapture",
            "vendorReturnedTexturePresent",
            "lateCaptureTaskObserverAttached"
        })
        {
            if (attemptFields.Contains(forbidden))
            {
                throw new InvalidOperationException(
                    "Obsolete or overclaimed capture-attempt field remains: " + forbidden);
            }
        }
    }

    private static void TestSnapshotChangeGate()
    {
        var firstMembers = new List<FileReceipt>
        {
            new FileReceipt("Grand_Hall.lcc2", "C:\\fixture\\Grand_Hall.lcc2", 1, "AA", 10)
        };
        var unchangedMembers = new List<FileReceipt>
        {
            new FileReceipt("Grand_Hall.lcc2", "C:\\fixture\\Grand_Hall.lcc2", 1, "AA", 10)
        };
        var touchedMembers = new List<FileReceipt>
        {
            new FileReceipt("Grand_Hall.lcc2", "C:\\fixture\\Grand_Hall.lcc2", 1, "AA", 11)
        };
        var before = new PackageSnapshot("C:\\fixture\\Grand_Hall.lcc2", firstMembers, "BB");
        var unchanged = new PackageSnapshot("C:\\fixture\\Grand_Hall.lcc2", unchangedMembers, "BB");
        var touched = new PackageSnapshot("C:\\fixture\\Grand_Hall.lcc2", touchedMembers, "BB");
        CapturePolicy.RequireUnchanged(before, unchanged);
        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireUnchanged(before, touched);
        });
    }

    private static void TestLiveCanonicalPackageReceipt()
    {
        PackageSnapshot before = CapturePolicy.SnapshotCanonicalPackage(CapturePolicy.CanonicalScenePath);
        AssertEqual(CapturePolicy.CanonicalMemberCount, before.Members.Count, "canonical member count");
        AssertEqual(CapturePolicy.CanonicalTotalByteLength, before.Members.Sum(member => member.ByteLength),
            "canonical total byte length");
        AssertEqual(CapturePolicy.CanonicalInventorySha256, before.InventorySha256,
            "canonical inventory SHA");
        FileReceipt manifest = before.Members.Single(member => member.RelativePath == "Grand_Hall.lcc2");
        AssertEqual(CapturePolicy.CanonicalManifestSha256, manifest.Sha256, "canonical manifest SHA");
        AssertEqual(1, before.Members.Count(member => member.RelativePath == @"data\3dgs\env.sog"),
            "environment SOG inventory member count");
        PackageSnapshot after = CapturePolicy.SnapshotCanonicalPackage(CapturePolicy.CanonicalScenePath);
        CapturePolicy.RequireUnchanged(before, after);
        Console.WriteLine("PASS: live canonical package " + before.InventorySha256);
    }

    private static byte[] CreatePngHeader(int width, int height)
    {
        var bytes = new byte[25];
        byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
        Array.Copy(signature, bytes, signature.Length);
        bytes[12] = (byte)'I';
        bytes[13] = (byte)'H';
        bytes[14] = (byte)'D';
        bytes[15] = (byte)'R';
        WriteBigEndian(bytes, 16, width);
        WriteBigEndian(bytes, 20, height);
        return bytes;
    }

    private static void WriteBigEndian(byte[] bytes, int offset, int value)
    {
        bytes[offset] = (byte)((value >> 24) & 0xff);
        bytes[offset + 1] = (byte)((value >> 16) & 0xff);
        bytes[offset + 2] = (byte)((value >> 8) & 0xff);
        bytes[offset + 3] = (byte)(value & 0xff);
    }

    private static void AssertEqual<T>(T expected, T actual, string label)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                label + " mismatch. Expected '" + expected + "' but received '" + actual + "'.");
        }
    }

    private static void ExpectThrows<TException>(Action action, string label = null)
        where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            return;
        }

        throw new InvalidOperationException(
            (String.IsNullOrEmpty(label) ? String.Empty : label + ": ") +
            "Expected exception " + typeof(TException).FullName + ".");
    }

    private static void DeleteOwnedTempTree(string path, string requiredPrefix)
    {
        string normalizedPath = Path.GetFullPath(path);
        string normalizedTemp = Path.GetFullPath(Path.GetTempPath());
        if (!normalizedPath.StartsWith(normalizedTemp, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(normalizedPath).StartsWith(requiredPrefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Refusing to delete an unowned test path: " + normalizedPath);
        }

        Directory.Delete(normalizedPath, true);
    }
}
