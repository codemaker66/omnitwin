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
            TestSingleCameraRenderRequestRoutePolicy();
            TestSnapFrameCaptureRoutePolicy();
            TestPngDimensionGate();
            TestDecodedRasterAdmissionGate();
            TestSnapshotChangeGate();
            DisplayEncodingTests.Run();

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

    private static void TestSingleCameraRenderRequestRoutePolicy()
    {
        SingleCameraRenderRequestSurfaceReceipt valid =
            CreateValidSingleCameraRenderRequestSurfaceReceipt();
        CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
            valid,
            CapturePolicy.SingleCameraRenderRequestPixelSource);
        CapturePolicy.RequireSingleCameraRenderRequestExactRasterBinding(
            valid,
            CreateValidSingleCameraRenderRequestRaster(new string('B', 64)));
        CapturePolicy.RequireSpawnPointVisualizationSuppression(
            valid.spawnPointVisualizationSuppression);

        int spawnPointInvalidationIndex = 0;
        foreach (Action<SingleCameraRenderRequestSurfaceReceipt> invalidate in
            new Action<SingleCameraRenderRequestSurfaceReceipt>[]
            {
                surface => surface.spawnPointVisualizationSuppression = null,
                surface => surface.spawnPointVisualizationSuppression
                    .selfModeOwnerLoadedSceneCount = 2,
                surface => surface.spawnPointVisualizationSuppression.targetCount += 1,
                surface => surface.spawnPointVisualizationSuppression
                    .forceRenderingOffSetterCallCount -= 1,
                surface => surface.spawnPointVisualizationSuppression.sceneDirtyAfter = true,
                surface => surface.spawnPointVisualizationSuppression
                    .unexpectedRenderPathAbsent = false,
                surface => surface.spawnPointVisualizationSuppression
                    .coveredSentinelRequestAndReadback = false,
                surface => surface.spawnPointVisualizationSuppression
                    .leaseHeldDuringEveryAcceptedAttempt = false,
                surface => surface.spawnPointVisualizationSuppression.everyTargetRestored = false,
                surface => surface.spawnPointVisualizationSuppression.disposed = false,
                surface => surface.spawnPointVisualizationSuppression.targets[1]
                    .rendererInstanceId = surface.spawnPointVisualizationSuppression
                        .targets[0].rendererInstanceId,
                surface => surface.spawnPointVisualizationSuppression.targets[0].role =
                    "other",
                surface => surface.spawnPointVisualizationSuppression.targets[0]
                    .ownerComponentTypeFullName =
                        "XGrids.LCCWorld.Framework.AvatarSpawnPointComponent",
                surface => surface.spawnPointVisualizationSuppression.targets[0]
                    .visualizationHierarchyPath = "unrelated/anchor_scale_3d[0]",
                surface => surface.spawnPointVisualizationSuppression.targets[0]
                    .forceRenderingOffObservedWhileSuppressed = false,
                surface => surface.spawnPointVisualizationSuppression.targets[0]
                    .forceRenderingOffAfter = true
            })
        {
            spawnPointInvalidationIndex += 1;
            SingleCameraRenderRequestSurfaceReceipt invalidSpawnPoint =
                CreateValidSingleCameraRenderRequestSurfaceReceipt();
            invalidate(invalidSpawnPoint);
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
                    invalidSpawnPoint,
                    CapturePolicy.SingleCameraRenderRequestPixelSource);
            }, "Spawn-point suppression adversarial mutation #" +
                spawnPointInvalidationIndex.ToString(CultureInfo.InvariantCulture));
        }

        SingleCameraRenderRequestSurfaceReceipt lazyInitialized =
            CreateValidSingleCameraRenderRequestSurfaceReceipt(true);
        AssertEqual(
            lazyInitialized.rendererConfigurationSignatureBeforeSha256,
            lazyInitialized.rendererConfigurationSignatureAfterSha256,
            "lazy-init configuration-only renderer signature");
        CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
            lazyInitialized,
            CapturePolicy.SingleCameraRenderRequestPixelSource);

        SingleCameraRenderRequestSurfaceReceipt contributorFree =
            CreateValidSingleCameraRenderRequestSurfaceReceipt();
        contributorFree.knownPotentialCameraCallbackContributorCount = 0;
        contributorFree.knownPotentialCameraCallbackContributorIdentities = new string[0];
        contributorFree.cameraCallbackContaminationExcluded = true;
        CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
            contributorFree,
            CapturePolicy.SingleCameraRenderRequestPixelSource);

        SingleCameraRenderRequestSurfaceReceipt rendererSignatureStable =
            CreateValidSingleCameraRenderRequestSurfaceReceipt();
        rendererSignatureStable.rendererInventoryAfter.observationFrame += 10;
        rendererSignatureStable.rendererInventoryAfter.observationRealtimeSeconds += 1.0;
        rendererSignatureStable.rendererStateSignatureAfterSha256 =
            CapturePolicy.ComputeUrpRendererStateSignature(
                rendererSignatureStable.rendererInventoryAfter);
        CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
            rendererSignatureStable,
            CapturePolicy.SingleCameraRenderRequestPixelSource);

        var fields = new HashSet<string>(typeof(SingleCameraRenderRequestSurfaceReceipt).GetFields(
            BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "entryPipelinePresent",
            "entryPipelineTypeFullName",
            "entryPipelineRuntimeIdentityHashCode",
            "graphicsSettingsAssetPresentBeforePreflight",
            "graphicsSettingsAssetTypeFullNameBeforePreflight",
            "graphicsSettingsAssetInstanceIdBeforePreflight",
            "capabilityPreflightCallCount",
            "capabilityPreflightDestinationInstanceId",
            "capabilityPreflightBoundToExactOwnedDestination",
            "capabilityPreflightSupportsRenderRequestReturnedTrue",
            "capabilityPreflightSubmitRenderRequestInvoked",
            "capabilityPreflightReadbackInvoked",
            "unityOwnedRuntimeInitializationOccurred",
            "establishedPipelinePresent",
            "establishedPipelineTypeFullName",
            "establishedPipelineRuntimeIdentityHashCode",
            "graphicsSettingsAssetPresentAfterPreflight",
            "graphicsSettingsAssetTypeFullNameAfterPreflight",
            "graphicsSettingsAssetInstanceIdAfterPreflight",
            "rendererConfigurationBeforePreflight",
            "rendererConfigurationAfterPreflight",
            "rendererConfigurationSignatureBeforeSha256",
            "rendererConfigurationSignatureAfterSha256",
            "rendererConfigurationStableAcrossInitialization",
            "pipelineTypeFullNameAfterOperation",
            "pipelineRuntimeIdentityHashCodeAfterOperation",
            "pipelineRuntimeIdentityStableAfterEstablishment",
            "disposableProcessOnlyRuntimeLifetime",
            "persistentRenderPipelineAssetMutationClaimed",
            "spawnPointVisualizationSuppression",
            "sceneCameraScreenRendererModeBefore",
            "sceneCameraScreenRendererModeAfter",
            "sceneCameraScreenRendererGetterContract",
            "sceneCameraScreenRendererSetterInvoked",
            "sceneCameraTargetTextureNullBeforeOperation",
            "sceneCameraTargetTextureNullAfterOperation",
            "knownPotentialCameraCallbackContributorCount",
            "knownPotentialCameraCallbackContributorIdentities",
            "cameraCallbackContaminationExcluded",
            "visualQaRequired",
            "captureAcceptanceScope",
            "finalSourceFaithfulAcceptanceClaimed",
            "cameraTargetTextureAssignedByModule",
            "ownedRenderTextureCreatedAfterRelease",
            "exactTextureOwnershipTransferred"
        })
        {
            if (!fields.Contains(expected))
            {
                throw new InvalidOperationException(
                    "Single-camera request surface receipt field is missing: " + expected);
            }
        }
        foreach (string removed in new[]
        {
            "pipelinePreinitializedBeforeSupportsCheck",
            "pipelineTypeFullNameBefore",
            "pipelineRuntimeIdentityHashCodeBefore",
            "pipelineTypeFullNameAfter",
            "pipelineRuntimeIdentityHashCodeAfter",
            "pipelineRuntimeIdentityStable",
            "sceneCameraScreenRendererDisabledBefore",
            "sceneCameraScreenRendererDisabledAfter"
        })
        {
            if (fields.Contains(removed))
            {
                throw new InvalidOperationException(
                    "Misleading v8 pipeline receipt field remains: " + removed);
            }
        }
        var configurationFields = new HashSet<string>(
            typeof(UrpRendererConfigurationReceipt).GetFields(
                BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string forbidden in new[]
        {
            "rendererInstances",
            "rendererInstanceCount",
            "snapFrameStaticInstancePresent",
            "snapFrameStaticInstanceId",
            "snapFrameStaticInstanceTypeFullName"
        })
        {
            if (configurationFields.Contains(forbidden))
            {
                throw new InvalidOperationException(
                    "Configuration-only renderer receipt exposes runtime state: " + forbidden);
            }
        }
        var invocationFields = new HashSet<string>(
            typeof(SingleCameraRenderRequestInvocationReceipt).GetFields(
                BindingFlags.Instance | BindingFlags.Public).Select(field => field.Name),
            StringComparer.Ordinal);
        foreach (string expected in new[]
        {
            "pipelineIdentityVerifiedAfterSupports",
            "rendererStateVerifiedAfterSupports"
        })
        {
            if (!invocationFields.Contains(expected))
            {
                throw new InvalidOperationException(
                    "Single-camera request invocation receipt field is missing: " + expected);
            }
        }

        int invalidationIndex = 0;
        foreach (Action<SingleCameraRenderRequestSurfaceReceipt> invalidate in
            new Action<SingleCameraRenderRequestSurfaceReceipt>[]
            {
                surface => surface.prohibitedFirstPartyMutationApis = new string[0],
                surface => surface.entryPipelinePresent = false,
                surface => surface.entryPipelineTypeFullName = "OtherPipeline",
                surface => surface.entryPipelineRuntimeIdentityHashCode += 1,
                surface => surface.graphicsSettingsAssetPresentBeforePreflight = false,
                surface => surface.graphicsSettingsAssetTypeFullNameBeforePreflight =
                    "OtherAsset",
                surface => surface.graphicsSettingsAssetInstanceIdBeforePreflight = 0,
                surface => surface.capabilityPreflightCallCount = 0,
                surface => surface.capabilityPreflightDestinationInstanceId += 1,
                surface => surface.capabilityPreflightBoundToExactOwnedDestination = false,
                surface => surface.capabilityPreflightSupportsRenderRequestReturnedTrue = false,
                surface => surface.capabilityPreflightSubmitRenderRequestInvoked = true,
                surface => surface.capabilityPreflightReadbackInvoked = true,
                surface => surface.unityOwnedRuntimeInitializationOccurred = true,
                surface => surface.establishedPipelinePresent = false,
                surface => surface.establishedPipelineTypeFullName = "OtherPipeline",
                surface => surface.establishedPipelineRuntimeIdentityHashCode += 1,
                surface => surface.graphicsSettingsAssetPresentAfterPreflight = false,
                surface => surface.graphicsSettingsAssetTypeFullNameAfterPreflight =
                    "OtherAsset",
                surface => surface.graphicsSettingsAssetInstanceIdAfterPreflight += 1,
                surface => surface.rendererConfigurationBeforePreflight = null,
                surface => surface.rendererConfigurationAfterPreflight = null,
                surface => surface.rendererConfigurationBeforePreflight.observationApi =
                    "GraphicsSettings.currentRenderPipeline",
                surface => surface.rendererConfigurationBeforePreflight.observationFrame = -1,
                surface => surface.rendererConfigurationBeforePreflight
                    .observationRealtimeSeconds = Double.NaN,
                surface => surface.rendererConfigurationBeforePreflight
                    .publicConfigurationGettersOnly = false,
                surface => surface.rendererConfigurationBeforePreflight
                    .runtimeRendererOrSingletonApiInvoked = true,
                surface => surface.rendererConfigurationBeforePreflight.mutationApiInvoked = true,
                surface => surface.rendererConfigurationBeforePreflight
                    .prohibitedRuntimeOrMutationApis = new string[0],
                surface => surface.rendererConfigurationBeforePreflight
                    .currentRenderPipelineAssetPresent = false,
                surface => surface.rendererConfigurationBeforePreflight
                    .currentRenderPipelineAssetTypeFullName = "OtherAsset",
                surface => surface.rendererConfigurationBeforePreflight
                    .currentRenderPipelineAssetInstanceId = 0,
                surface => surface.rendererConfigurationBeforePreflight
                    .currentRenderPipelineAssetIsUniversal = false,
                surface => surface.rendererConfigurationBeforePreflight.rendererDataCount = 0,
                surface => surface.rendererConfigurationBeforePreflight.rendererData = null,
                surface => surface.rendererConfigurationBeforePreflight
                    .snapFrameCaptureFeatureCount = 0,
                surface => surface.rendererConfigurationBeforePreflight
                    .activeSnapFrameCaptureFeatureCount = 1,
                surface => surface.rendererConfigurationBeforePreflight
                    .rendererDataFeatureIdentityAndActiveStateStableDuringSynchronousObservation =
                        false,
                surface => surface.rendererConfigurationBeforePreflight
                    .mutationObservedDuringSynchronousObservation = true,
                surface => surface.rendererConfigurationSignatureBeforeSha256 =
                    new string('C', 64),
                surface => surface.rendererConfigurationSignatureAfterSha256 =
                    new string('C', 64),
                surface => surface.rendererConfigurationStableAcrossInitialization = false,
                surface =>
                {
                    surface.rendererConfigurationAfterPreflight.rendererData[0]
                        .features[0].active = true;
                    surface.rendererConfigurationAfterPreflight
                        .activeSnapFrameCaptureFeatureCount = 1;
                },
                surface => surface.pipelinePresentAfterOperation = false,
                surface => surface.pipelineTypeFullNameAfterOperation = "OtherPipeline",
                surface => surface.pipelineRuntimeIdentityHashCodeAfterOperation += 1,
                surface => surface.pipelineRuntimeIdentityStableAfterEstablishment = false,
                surface => surface.disposableProcessOnlyRuntimeLifetime = false,
                surface => surface.persistentRenderPipelineAssetMutationClaimed = true,
                surface => surface.sceneCameraScreenRendererModeBefore = false,
                surface => surface.sceneCameraScreenRendererModeAfter = false,
                surface => surface.sceneCameraScreenRendererGetterContract =
                    "false_when_m_tempRT_is_null",
                surface => surface.sceneCameraScreenRendererSetterInvoked = true,
                surface => surface.sceneCameraTargetTextureNullBeforeOperation = false,
                surface => surface.sceneCameraTargetTextureNullAfterOperation = false,
                surface => surface.cameraCallbackContributorInventoryCompleted = false,
                surface => surface.knownPotentialCameraCallbackContributorCount += 1,
                surface => surface.knownPotentialCameraCallbackContributorIdentities =
                    new[] { "LCCCore.CameraDraw#-909", "LCCCore.CameraDraw#-909" },
                surface => surface.cameraCallbackContaminationExcluded = true,
                surface => surface.visualQaRequired = false,
                surface => surface.captureAcceptanceScope = "final_source_faithful",
                surface => surface.finalSourceFaithfulAcceptanceClaimed = true,
                surface => surface.activeCanvases[0].excludedByNonNullTargetContract = false,
                surface =>
                {
                    surface.activeCanvases[0].renderMode = "WorldSpace";
                    surface.activeCanvases[0].excludedByNonNullTargetContract = false;
                    surface.activeCanvases[0].canRenderIntoRequest = false;
                },
                surface =>
                {
                    surface.sceneCameraCullingMask = 0;
                    surface.sceneCameraCullingMaskAfter = 0;
                    surface.activeCanvases[0].renderMode = "ScreenSpaceCamera";
                    surface.activeCanvases[0].layerIncludedBySceneCamera = false;
                    surface.activeCanvases[0].excludedByNonNullTargetContract = false;
                    surface.activeCanvases[0].canRenderIntoRequest = false;
                },
                surface => surface.activeCanvases[0].layerIncludedBySceneCamera = false,
                surface => surface.activeCanvases[0].worldCameraMatchesSceneCamera = true,
                surface => surface.activeColorSpace = "Linear",
                surface => surface.activeColorSpaceAfter = "Linear",
                surface => surface.sceneCameraEnabledAfter = false,
                surface => surface.sceneCameraClearFlagsAfter = "Depth",
                surface => surface.sceneCameraDepthAfter += 1.0f,
                surface => surface.universalAdditionalCameraDataPresentAfter = false,
                surface => surface.universalCameraRenderTypeAfter = "Overlay",
                surface => surface.universalRenderPostProcessingAfter = true,
                surface => surface.sentinelRequest.requestNonce =
                    surface.exactRequest.requestNonce,
                surface =>
                {
                    foreach (SingleCameraRenderRequestCallbackReceipt callback in
                        surface.exactRequest.callbacks)
                    {
                        callback.frame = surface.sentinelRequest.callbacks[0].frame;
                    }
                    surface.exactRequest.readback.observationFrame =
                        surface.sentinelRequest.callbacks[0].frame;
                },
                surface => surface.exactRequest.requestDestinationInstanceId += 1,
                surface => surface.exactRequest.requestDestinationMatchesOwnedTarget = false,
                surface => surface.exactRequest.originalCameraTargetTextureNull = false,
                surface => surface.exactRequest.supportsRenderRequestCallCount = 2,
                surface => surface.exactRequest.pipelineIdentityVerifiedAfterSupports = false,
                surface => surface.exactRequest.rendererStateVerifiedAfterSupports = false,
                surface => surface.exactRequest.submitRenderRequestCallCount = 2,
                surface => surface.exactRequest.targetBeforeSubmit.requestedGraphicsFormat =
                    "R16G16B16A16_SFloat",
                surface => surface.exactRequest.targetBeforeSubmit.requestedSrgb = true,
                surface => surface.exactRequest.targetBeforeSubmit.effectiveGraphicsFormat =
                    "R16G16B16A16_SFloat",
                surface => surface.exactRequest.targetBeforeSubmit.effectiveSrgb = true,
                surface => surface.exactRequest.targetBeforeSubmit
                    .requestedAndEffectiveFormatMatch = false,
                surface => surface.exactRequest.targetBeforeSubmit.colorFormat = "ARGBHalf",
                surface => surface.exactRequest.targetBeforeSubmit.mipCount = 2,
                surface => surface.exactRequest.targetBeforeSubmit.depthStencilFormat =
                    "D24_UNorm_S8_UInt",
                surface => surface.exactRequest.targetBeforeSubmit
                    .effectiveGraphicsFormatRenderSupported =
                    false,
                surface => surface.exactRequest.targetAfterSubmit.width -= 1,
                surface => surface.exactRequest.callbacks[2].realtimeSeconds = 1.0,
                surface => surface.exactRequest.readback.observationFrame += 1,
                surface => surface.exactRequest.readback.width -= 1,
                surface => surface.exactRequest.readback.rgb24ByteLength -= 3,
                surface => surface.exactRequest.readback.rgb24Sha256 = new string('C', 64),
                surface => surface.exactRequest.readback.readbackCompletedAfterSubmitReturned =
                    false,
                surface => surface.sentinelRaster.rgb24Sha256 = new string('C', 64),
                surface => surface.rendererStateSignatureBeforeSha256 = new string('C', 64),
                surface => surface.rendererInventoryAfter.rendererData[0].useNativeRenderPass = true,
                surface => surface.cameraTargetTextureAssignedByModule = true,
                surface => surface.ownedRenderTextureCreatedAfterRelease = true,
                surface => surface.exactTextureOwnershipTransferred = false
            })
        {
            invalidationIndex += 1;
            SingleCameraRenderRequestSurfaceReceipt invalid =
                CreateValidSingleCameraRenderRequestSurfaceReceipt();
            invalidate(invalid);
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
                    invalid,
                    CapturePolicy.SingleCameraRenderRequestPixelSource);
            }, "SingleCameraRequest adversarial mutation #" +
                invalidationIndex.ToString(CultureInfo.InvariantCulture));
        }

        int lazyInvalidationIndex = 0;
        foreach (Action<SingleCameraRenderRequestSurfaceReceipt> invalidate in
            new Action<SingleCameraRenderRequestSurfaceReceipt>[]
            {
                surface => surface.entryPipelinePresent = true,
                surface => surface.entryPipelineTypeFullName =
                    "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
                surface => surface.entryPipelineRuntimeIdentityHashCode = 5150,
                surface => surface.unityOwnedRuntimeInitializationOccurred = false
            })
        {
            lazyInvalidationIndex += 1;
            SingleCameraRenderRequestSurfaceReceipt invalidLazy =
                CreateValidSingleCameraRenderRequestSurfaceReceipt(true);
            invalidate(invalidLazy);
            ExpectThrows<InvalidOperationException>(delegate
            {
                CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
                    invalidLazy,
                    CapturePolicy.SingleCameraRenderRequestPixelSource);
            }, "Lazy SingleCameraRequest preflight adversarial mutation #" +
                lazyInvalidationIndex.ToString(CultureInfo.InvariantCulture));
        }

        ExpectThrows<InvalidOperationException>(delegate
        {
            CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
                CreateValidSingleCameraRenderRequestSurfaceReceipt(),
                "screen_backbuffer");
        });
        ExpectThrows<InvalidOperationException>(delegate
        {
            SingleCameraRenderRequestSurfaceReceipt mismatched =
                CreateValidSingleCameraRenderRequestSurfaceReceipt();
            CapturePolicy.RequireSingleCameraRenderRequestExactRasterBinding(
                mismatched,
                CreateValidSingleCameraRenderRequestRaster(new string('C', 64)));
        });
    }

    private static SingleCameraRenderRequestSurfaceReceipt
        CreateValidSingleCameraRenderRequestSurfaceReceipt(bool lazyInitialization = false)
    {
        const int sceneCameraInstanceId = -202;
        const int targetInstanceId = -303;
        const int sentinelFrame = 110;
        const int exactFrame = 112;
        string sentinelSha256 = new string('A', 64);
        string exactSha256 = new string('B', 64);
        UrpRendererConfigurationReceipt configurationBefore =
            CreateValidUrpRendererConfigurationReceipt();
        UrpRendererConfigurationReceipt configurationAfter =
            CreateValidUrpRendererConfigurationReceipt();
        configurationAfter.observationFrame = 11;
        configurationAfter.observationRealtimeSeconds = 2.0;
        UrpRendererInventoryReceipt rendererBefore = CreateValidUrpRendererInventory();
        UrpRendererInventoryReceipt rendererAfter = CreateValidUrpRendererInventory();
        var surface = new SingleCameraRenderRequestSurfaceReceipt
        {
            pixelSurfaceProvenance =
                CapturePolicy.SingleCameraRenderRequestSurfaceProvenance,
            renderBoundaryEvidence =
                CapturePolicy.SingleCameraRenderRequestRenderBoundaryEvidence,
            lockedRequestType =
                "UnityEngine.Rendering.Universal.UniversalRenderPipeline+SingleCameraRequest",
            urpRendererDataOrFeatureMutationApiInvoked = false,
            prohibitedFirstPartyMutationApis =
                CapturePolicy.CreateSingleCameraRenderRequestProhibitedMutationApis(),
            entryPipelinePresent = !lazyInitialization,
            entryPipelineTypeFullName = lazyInitialization
                ? null
                : "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
            entryPipelineRuntimeIdentityHashCode = lazyInitialization ? 0 : 5150,
            graphicsSettingsAssetPresentBeforePreflight = true,
            graphicsSettingsAssetTypeFullNameBeforePreflight =
                "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset",
            graphicsSettingsAssetInstanceIdBeforePreflight = 10,
            capabilityPreflightCallCount = 1,
            capabilityPreflightDestinationInstanceId = targetInstanceId,
            capabilityPreflightBoundToExactOwnedDestination = true,
            capabilityPreflightSupportsRenderRequestReturnedTrue = true,
            capabilityPreflightSubmitRenderRequestInvoked = false,
            capabilityPreflightReadbackInvoked = false,
            unityOwnedRuntimeInitializationOccurred = lazyInitialization,
            establishedPipelinePresent = true,
            establishedPipelineTypeFullName =
                "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
            establishedPipelineRuntimeIdentityHashCode = 5150,
            graphicsSettingsAssetPresentAfterPreflight = true,
            graphicsSettingsAssetTypeFullNameAfterPreflight =
                "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset",
            graphicsSettingsAssetInstanceIdAfterPreflight = 10,
            rendererConfigurationBeforePreflight = configurationBefore,
            rendererConfigurationAfterPreflight = configurationAfter,
            rendererConfigurationStableAcrossInitialization = true,
            pipelinePresentAfterOperation = true,
            pipelineTypeFullNameAfterOperation =
                "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
            pipelineRuntimeIdentityHashCodeAfterOperation = 5150,
            pipelineRuntimeIdentityStableAfterEstablishment = true,
            disposableProcessOnlyRuntimeLifetime = true,
            persistentRenderPipelineAssetMutationClaimed = false,
            renderTextureActiveRestoredAfterOperation = true,
            sceneCameraLive = true,
            sceneCameraInstanceId = sceneCameraInstanceId,
            captureViewAbsentBefore = true,
            captureViewAbsentAfter = true,
            sceneCameraScreenRendererModeBefore = true,
            sceneCameraScreenRendererModeAfter = true,
            sceneCameraScreenRendererGetterContract =
                CapturePolicy.SceneCameraScreenRendererGetterContract,
            sceneCameraScreenRendererSetterInvoked = false,
            sceneCameraTargetTextureNullBeforeOperation = true,
            sceneCameraTargetTextureNullAfterOperation = true,
            knownActiveCaptureOverlayCount = 0,
            knownActiveCaptureOverlayNames = new string[0],
            cameraCallbackContributorInventoryCompleted = true,
            knownPotentialCameraCallbackContributorCount = 1,
            knownPotentialCameraCallbackContributorIdentities =
                new[] { "LCCCore.CameraDraw#-909" },
            cameraCallbackContaminationExcluded = false,
            visualQaRequired = true,
            captureAcceptanceScope = CapturePolicy.SingleCameraRenderRequestAcceptanceScope,
            finalSourceFaithfulAcceptanceClaimed = false,
            activeCanvases = new List<NativeCanvasReceipt>
            {
                new NativeCanvasReceipt
                {
                    instanceId = -707,
                    name = "SnapIndicatorCanvas",
                    renderMode = "ScreenSpaceOverlay",
                    layer = 5,
                    layerName = "UI",
                    worldCameraInstanceId = 0,
                    worldCameraMatchesSceneCamera = false,
                    layerIncludedBySceneCamera = true,
                    canRenderIntoRequest = false,
                    excludedByNonNullTargetContract = true
                }
            },
            unsafeCanvasObserved = false,
            activeScreenSpaceOverlayCanvasCount = 1,
            screenSpaceOverlayExcludedByRequestContract = true,
            graphicsDeviceType = "Direct3D12",
            graphicsUvStartsAtTop = true,
            activeColorSpace = CapturePolicy.SingleCameraRenderRequestColorSpace,
            activeColorSpaceAfter = CapturePolicy.SingleCameraRenderRequestColorSpace,
            readPixelsCoordinateOrigin =
                CapturePolicy.SingleCameraRenderRequestReadPixelsCoordinateOrigin,
            cpuRowTransform = CapturePolicy.SingleCameraRenderRequestCpuRowTransform,
            cpuOrientationStatus = "unverified_pending_visual_qa",
            sceneCameraPixelWidth = CapturePolicy.CaptureWidth,
            sceneCameraPixelHeight = CapturePolicy.CaptureHeight,
            sceneCameraCullingMask = -1,
            sceneCameraCullingMaskAfter = -1,
            sceneCameraTargetDisplay = 0,
            sceneCameraTargetDisplayAfter = 0,
            sceneCameraEnabledBefore = true,
            sceneCameraEnabledAfter = true,
            sceneCameraClearFlags = "Color",
            sceneCameraClearFlagsAfter = "Color",
            sceneCameraDepth = 0.0f,
            sceneCameraDepthAfter = 0.0f,
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
            universalAdditionalCameraDataPresentAfter = true,
            universalCameraRenderType = "Base",
            universalCameraRenderTypeAfter = "Base",
            cameraStackGetterInvoked = false,
            cameraStackBypassedByRequestContract = true,
            universalRenderPostProcessing = false,
            universalRenderPostProcessingAfter = false,
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
            sentinelRaster = CreateValidSingleCameraRenderRequestRaster(sentinelSha256),
            exactFrameRgb24Sha256 = exactSha256,
            sentinelAndExactRgbDiffer = true,
            exactRestoreVerified = true,
            rendererInventoryBefore = rendererBefore,
            rendererInventoryAfter = rendererAfter,
            rendererDataFeatureIdentityAndActiveStateStable = true,
            snapFrameApiInvoked = false,
            snapFramePixelSourceUsed = false,
            snapFrameExecutionPrevented = false,
            cameraTargetTextureAssignedByModule = false,
            ownedRenderTextureReleaseRequested = true,
            ownedRenderTextureCreatedAfterRelease = false,
            ownedRenderTextureDestroyRequested = true,
            sentinelTextureDestroyRequested = true,
            returnedTextureDestroyRequested = false,
            exactTextureOwnershipTransferred = true,
            unownedResourceDestroyOrReleaseRequested = false,
            spawnPointVisualizationSuppression =
                CreateValidSpawnPointVisualizationSuppressionReceipt()
        };
        surface.sentinelRequest = CreateValidSingleCameraRenderRequestInvocation(
            "sentinel_discard",
            CapturePolicy.Sha256Text("sentinel request"),
            sentinelFrame,
            sceneCameraInstanceId,
            targetInstanceId,
            -405,
            sentinelSha256,
            true);
        surface.exactRequest = CreateValidSingleCameraRenderRequestInvocation(
            "stable_exact",
            CapturePolicy.Sha256Text("exact request"),
            exactFrame,
            sceneCameraInstanceId,
            targetInstanceId,
            -404,
            exactSha256,
            false);
        surface.rendererStateSignatureBeforeSha256 =
            CapturePolicy.ComputeUrpRendererStateSignature(rendererBefore);
        surface.rendererStateSignatureAfterSha256 =
            CapturePolicy.ComputeUrpRendererStateSignature(rendererAfter);
        surface.rendererConfigurationSignatureBeforeSha256 =
            CapturePolicy.ComputeUrpRendererConfigurationSignature(configurationBefore);
        surface.rendererConfigurationSignatureAfterSha256 =
            CapturePolicy.ComputeUrpRendererConfigurationSignature(configurationAfter);
        return surface;
    }

    private static SpawnPointVisualizationSuppressionReceipt
        CreateValidSpawnPointVisualizationSuppressionReceipt()
    {
        const string OwnerRoot = "Scene[0]/SpawnPoints[0]";
        var targets = new List<SpawnPointVisualizationTargetReceipt>
        {
            CreateValidSpawnPointVisualizationTarget(
                "self_mode",
                "XGrids.LCCWorld.Framework.SelfModeSpawnPointComponent",
                -1001,
                OwnerRoot + "/SelfMode[0]",
                -1101,
                -1201,
                -1301),
            CreateValidSpawnPointVisualizationTarget(
                "avatar",
                "XGrids.LCCWorld.Framework.AvatarSpawnPointComponent",
                -1002,
                OwnerRoot + "/Avatar[1]",
                -1102,
                -1202,
                -1302)
        };
        return new SpawnPointVisualizationSuppressionReceipt
        {
            purpose =
                "exclude_only_generated_self_and_avatar_spawn_point_anchor_visualizations_from_exact_native_pixels",
            selectionContract =
                "exactly_one_loaded_active_enabled_SelfModeSpawnPointComponent_and_AvatarSpawnPointComponent_in_one_scene_each_with_one_loaded_active_enabled_SpawnPointElement_AnchorScale3D_and_every_descendant_UnityEngine.Renderer_forceRenderingOff",
            mutationApi = "UnityEngine.Renderer.forceRenderingOff",
            expectedSceneHandle = 44,
            expectedScenePath = "TempProject/GrandHall",
            selfModeOwnerLoadedSceneCount = 1,
            avatarOwnerLoadedSceneCount = 1,
            selfModeOwnerActiveEnabledCount = 1,
            avatarOwnerActiveEnabledCount = 1,
            selfModeVisualizationElementTotalCount = 1,
            avatarVisualizationElementTotalCount = 1,
            selfModeVisualizationElementActiveEnabledCount = 1,
            avatarVisualizationElementActiveEnabledCount = 1,
            targetCount = targets.Count,
            initiallyRenderableTargetCount = targets.Count,
            selfModeInitiallyRenderableTargetCount = 1,
            avatarInitiallyRenderableTargetCount = 1,
            targets = targets,
            unexpectedRenderPathComponentTypeNames = new string[0],
            unexpectedRenderPathAbsent = true,
            forceRenderingOffSetterCallCount = targets.Count * 2,
            restoreAttemptCount = 1,
            suppressionCheckpointCount = 12,
            sceneDirtyBefore = false,
            sceneDirtyWhileSuppressed = false,
            sceneDirtyAfter = false,
            sceneDirtyFalseAtEntry = true,
            sceneDirtyEqualAtEveryCheckpoint = true,
            identityStableAtEveryCheckpoint = true,
            coveredSentinelRequestAndReadback = true,
            coveredExactRequestAndReadback = true,
            leaseHeldDuringEveryAcceptedAttempt = true,
            everyTargetSuppressed = true,
            everyTargetRestored = true,
            disposed = true
        };
    }

    private static SpawnPointVisualizationTargetReceipt
        CreateValidSpawnPointVisualizationTarget(
            string role,
            string ownerType,
            int ownerId,
            string ownerPath,
            int elementId,
            int visualizationId,
            int rendererId)
    {
        string elementPath = ownerPath + "/spawn_point_element[0]";
        string visualizationPath = elementPath + "/anchor_scale_3d[0]";
        return new SpawnPointVisualizationTargetReceipt
        {
            role = role,
            ownerComponentTypeFullName = ownerType,
            ownerComponentInstanceId = ownerId,
            ownerHierarchyPath = ownerPath,
            ownerSceneHandle = 44,
            ownerScenePath = "TempProject/GrandHall",
            spawnPointElementInstanceId = elementId,
            spawnPointElementHierarchyPath = elementPath,
            visualizationComponentTypeFullName =
                "XGrids.LCCWorld.Common.Components.AnchorScale3D",
            visualizationComponentInstanceId = visualizationId,
            visualizationHierarchyPath = visualizationPath,
            rendererTypeFullName = "UnityEngine.MeshRenderer",
            rendererInstanceId = rendererId,
            rendererHierarchyPath = visualizationPath + "/icon[0]",
            rendererGameObjectInstanceId = rendererId - 100,
            rendererLayer = 0,
            rendererLayerName = "Default",
            rendererLayerIncludedBySceneCamera = true,
            rendererEnabledBefore = true,
            forceRenderingOffBefore = false,
            activeInHierarchyBefore = true,
            initiallyRenderableBySceneCamera = true,
            suppressionRequested = true,
            forceRenderingOffObservedWhileSuppressed = true,
            restorationRequested = true,
            rendererEnabledAfter = true,
            forceRenderingOffAfter = false,
            activeInHierarchyAfter = true,
            identityStableAtEveryCheckpoint = true,
            exactRendererStateRestored = true
        };
    }

    private static UrpRendererConfigurationReceipt
        CreateValidUrpRendererConfigurationReceipt()
    {
        return new UrpRendererConfigurationReceipt
        {
            observationApi =
                "GraphicsSettings.currentRenderPipeline + UniversalRenderPipelineAsset.rendererDataList + ScriptableRendererData.rendererFeatures",
            observationFrame = 10,
            observationRealtimeSeconds = 1.0,
            publicConfigurationGettersOnly = true,
            runtimeRendererOrSingletonApiInvoked = false,
            mutationApiInvoked = false,
            prohibitedRuntimeOrMutationApis =
                CapturePolicy.CreateUrpRendererConfigurationProhibitedRuntimeOrMutationApis(),
            currentRenderPipelineAssetPresent = true,
            currentRenderPipelineAssetName = "URP asset",
            currentRenderPipelineAssetTypeFullName =
                "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset",
            currentRenderPipelineAssetInstanceId = 10,
            currentRenderPipelineAssetIsUniversal = true,
            rendererDataCount = 1,
            rendererData = new List<UrpRendererConfigurationDataReceipt>
            {
                new UrpRendererConfigurationDataReceipt
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
                    features = new List<UrpRendererConfigurationFeatureReceipt>
                    {
                        new UrpRendererConfigurationFeatureReceipt
                        {
                            featureIndex = 0,
                            present = true,
                            name = "SnapFrameCaptureFeature",
                            typeFullName = CapturePolicy.SnapFrameFeatureTypeFullName,
                            instanceId = 12,
                            active = false,
                            snapFrameCaptureFeatureType = true
                        }
                    }
                }
            },
            snapFrameCaptureFeatureCount = 1,
            activeSnapFrameCaptureFeatureCount = 0,
            rendererDataFeatureIdentityAndActiveStateStableDuringSynchronousObservation = true,
            mutationObservedDuringSynchronousObservation = false
        };
    }

    private static SingleCameraRenderRequestInvocationReceipt
        CreateValidSingleCameraRenderRequestInvocation(
            string stage,
            string requestNonce,
            int frame,
            int sceneCameraInstanceId,
            int targetInstanceId,
            int textureInstanceId,
            string rgb24Sha256,
            bool sentinel)
    {
        return new SingleCameraRenderRequestInvocationReceipt
        {
            stage = stage,
            requestNonce = requestNonce,
            requestMipLevel = 0,
            requestSlice = 0,
            requestCubemapFace = "Unknown",
            requestDestinationInstanceId = targetInstanceId,
            requestDestinationMatchesOwnedTarget = true,
            requestDirectTex2DMipZeroContract = true,
            supportsRenderRequestCallCount = 1,
            supportsRenderRequestReturnedTrue = true,
            pipelineIdentityVerifiedAfterSupports = true,
            rendererStateVerifiedAfterSupports = true,
            submitRenderRequestCallCount = 1,
            submitRenderRequestInvoked = true,
            submitRenderRequestReturned = true,
            submitRenderRequestThrew = false,
            targetBeforeSubmit = CreateValidSingleCameraRenderRequestTarget(targetInstanceId),
            targetAfterSubmit = CreateValidSingleCameraRenderRequestTarget(targetInstanceId),
            targetIdentityAndDescriptorStable = true,
            originalCameraTargetTextureNull = true,
            originalCameraTargetTextureInstanceId = 0,
            cameraTargetTextureRestored = true,
            callbackSubscriptionsRemoved = true,
            callbackFailureObserved = false,
            callbackHistoryOverflowed = false,
            callbacks = CreateValidSingleCameraRenderRequestCallbacks(
                requestNonce,
                frame,
                sceneCameraInstanceId,
                targetInstanceId,
                sentinel),
            exactFourEventTranscriptVerified = true,
            readback = CreateValidSingleCameraRenderRequestReadback(
                frame,
                targetInstanceId,
                textureInstanceId,
                rgb24Sha256)
        };
    }

    private static SingleCameraRenderRequestTargetReceipt
        CreateValidSingleCameraRenderRequestTarget(int targetInstanceId)
    {
        return new SingleCameraRenderRequestTargetReceipt
        {
            instanceId = targetInstanceId,
            ownedByModule = true,
            created = true,
            width = CapturePolicy.CaptureWidth,
            height = CapturePolicy.CaptureHeight,
            volumeDepth = 1,
            depthBits = 0,
            depthStencilFormat = CapturePolicy.SingleCameraRenderRequestDepthStencilFormat,
            antiAliasing = 1,
            mipCount = 1,
            dimension = "Tex2D",
            colorFormat = CapturePolicy.SingleCameraRenderRequestColorFormat,
            requestedGraphicsFormat = CapturePolicy.SingleCameraRenderRequestGraphicsFormat,
            requestedSrgb = CapturePolicy.SingleCameraRenderRequestSrgb,
            effectiveGraphicsFormat = CapturePolicy.SingleCameraRenderRequestGraphicsFormat,
            effectiveGraphicsFormatRenderSupported = true,
            effectiveSrgb = CapturePolicy.SingleCameraRenderRequestSrgb,
            requestedAndEffectiveFormatMatch = true,
            useMipMap = false,
            autoGenerateMips = false,
            useDynamicScale = false,
            enableRandomWrite = false
        };
    }

    private static SingleCameraRenderRequestReadbackReceipt
        CreateValidSingleCameraRenderRequestReadback(
            int frame,
            int targetInstanceId,
            int textureInstanceId,
            string rgb24Sha256)
    {
        return new SingleCameraRenderRequestReadbackReceipt
        {
            observationFrame = frame,
            sourceRenderTextureInstanceId = targetInstanceId,
            sourceOwnedAndCreatedBeforeReadback = true,
            width = CapturePolicy.CaptureWidth,
            height = CapturePolicy.CaptureHeight,
            rgb24ByteLength =
                (long)CapturePolicy.CaptureWidth * CapturePolicy.CaptureHeight * 3L,
            rgb24Sha256 = rgb24Sha256,
            renderTextureActiveWasNullBeforeReadback = true,
            renderTextureActiveBeforeReadbackInstanceId = 0,
            renderTextureActiveBoundForReadbackInstanceId = targetInstanceId,
            exactOwnedRenderTextureActiveBeforeReadPixels = true,
            renderTextureActiveWasNullAfterReadback = true,
            renderTextureActiveAfterReadbackInstanceId = 0,
            renderTextureActiveRestored = true,
            firstPartyReadPixelsCompleted = true,
            firstPartyApplyCompleted = true,
            firstPartyTextureInstanceId = textureInstanceId,
            firstPartyTextureFormat = "RGB24",
            firstPartyTextureReadable = true,
            firstPartyTextureNoMipChain = true,
            firstPartyTextureDistinctFromOwnedRenderTexture = true,
            readbackCompletedAfterSubmitReturned = true
        };
    }

    private static List<SingleCameraRenderRequestCallbackReceipt>
        CreateValidSingleCameraRenderRequestCallbacks(
            string requestNonce,
            int frame,
            int sceneCameraInstanceId,
            int targetInstanceId,
            bool sentinel)
    {
        var callbacks = new List<SingleCameraRenderRequestCallbackReceipt>();
        string[] stages = { "beginContext", "beginCamera", "endCamera", "endContext" };
        for (int index = 0; index < stages.Length; index += 1)
        {
            callbacks.Add(new SingleCameraRenderRequestCallbackReceipt
            {
                sequence = index + 1,
                callback = stages[index],
                requestNonce = requestNonce,
                frame = frame,
                realtimeSeconds = 10.0 + index,
                cameraCount = 1,
                cameraInstanceIds = new[] { sceneCameraInstanceId },
                exactSceneCameraOnly = true,
                cameraTargetMatchesOwnedRenderTexture = true,
                cameraTargetTextureInstanceId = targetInstanceId,
                poseMatchesRequestedStage = true,
                projectionMatchesExactProfile = true,
                position = sentinel
                    ? new[] { 1.05, 2.0, 3.0 }
                    : new[] { 1.0, 2.0, 3.0 },
                rotationXyzw = new[] { 0.0, 0.0, 0.0, 1.0 },
                worldToCameraMatrixColumnMajor = IdentityMatrix(),
                projectionMatrixColumnMajor = IdentityMatrix()
            });
        }
        return callbacks;
    }

    private static RasterStatisticsReceipt CreateValidSingleCameraRenderRequestRaster(
        string rgb24Sha256)
    {
        return new RasterStatisticsReceipt
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
            rgb24Sha256 = rgb24Sha256,
            nonDegenerateVerified = true
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
