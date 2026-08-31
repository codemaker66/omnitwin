using System.Collections.Generic;

namespace Venviewer.NativeCapture
{
    internal sealed class HashReceipt
    {
        public string path;
        public long byteLength;
        public string sha256;
        public string fileVersion;
    }

    internal sealed class InputMemberReceipt
    {
        public string relativePath;
        public string absolutePath;
        public long byteLength;
        public string sha256;
        public long lastWriteTimeUtcTicks;
    }

    internal sealed class InputReceipt
    {
        public string scenePath;
        public string manifestSha256;
        public string inventorySha256;
        public int memberCount;
        public long totalByteLength;
        public List<InputMemberReceipt> members;
        public bool beforeAfterByteIdentityVerified;
        public bool beforeAfterTimestampIdentityVerified;
        public bool preLoadThroughPostCaptureIdentityVerified;
    }

    internal sealed class VendorReceipt
    {
        public string xgridsInstalledVersion;
        public string unityVersion;
        public string lccSdkReportedVersion;
        public string rendererApplication;
        public List<HashReceipt> lockedFiles;
        public RuntimeClosureReceipt runtimeClosure;
    }

    internal sealed class RuntimeClosureMemberReceipt
    {
        public string relativePath;
        public long byteLength;
        public string sha256;
    }

    internal sealed class RuntimeClosureReceipt
    {
        public string lockPath;
        public string lockSha256;
        public string selectionPolicy;
        public string[] excludedRelativeRoots;
        public string[] enabledStockModuleIds;
        public string[] enabledStockModuleRoots;
        public string inventorySha256;
        public int memberCount;
        public long totalByteLength;
        public List<RuntimeClosureMemberReceipt> members;
        public string[] limitations;
        public bool boundedInventoryVerified;
        public bool preLoadAndPostCaptureIdentityVerified;
    }

    internal sealed class ModuleReceipt
    {
        public string id;
        public string version;
        public HashReceipt assembly;
        public HashReceipt manifest;
        public string buildReceiptExpectedAssemblySha256;
        public string buildReceiptExpectedManifestSha256;
    }

    internal sealed class CameraReceipt
    {
        public string cameraId;
        public int sourcePoseIndex;
        public string sourcePoseTimestamp;
        public string sourceFrame;
        public string nativeFrame;
        public string targetDerivation;
        public string targetCalibrationStatus;
        public double[] sourcePosition;
        public double[] sourceTarget;
        public double[] sourceUp;
        public double[] nativePosition;
        public double[] nativeTarget;
        public double[] nativeUp;
        public double[] nativeDirection;
        public double[] nativeQuaternionXyzw;
        public double[] expectedRawNativePosition;
        public double[] expectedRawNativeTarget;
        public double[] expectedRawNativeUp;
        public double[] expectedRawNativeDirection;
        public double[] expectedRawNativeQuaternionXyzw;
        public double rawNativeAssertionTolerance;
        public double[] lccLocalToWorldMatrixColumnMajor;
        public string projection;
        public float verticalFieldOfViewDegrees;
        public float nearClipMetres;
        public float farClipMetres;
        public float aspect;
    }

    internal sealed class CameraProfileReceipt
    {
        public string path;
        public string sha256;
        public string schemaVersion;
        public string profileId;
        public string sourceFrame;
        public string nativeFrame;
        public string threeFrame;
        public bool inspectionOnly;
        public bool environmentIncluded;
        public string environmentExclusionReason;
    }

    internal sealed class SceneLoadReceipt
    {
        public string api;
        public string requestedPath;
        public bool commandLineSceneArgumentUsed;
        public bool preloadedSceneRejected;
        public bool freshProjectStateVerified;
        public bool temporaryProjectCreationSucceeded;
        public bool projectInitializedVerified;
        public bool temporaryProjectVerified;
        public bool currentSceneDataNonNull;
        public bool generatedLccAssetPresent;
        public string generatedLccAssetPath;
        public string generatedLccAssetResolvedPath;
        public bool generatedLccAssetPathVerified;
        public bool defaultSceneLoadAccepted;
        public string eventTopic;
        public bool eventSubscriptionAccepted;
        public string eventPath;
        public bool eventPathVerified;
        public bool rendererHandlerNonNull;
        public string rendererHandlerPath;
        public bool rendererHandlerPathVerified;
        public bool canonicalSceneLoadedVerified;
        public string renderAllBeginEventTopic;
        public bool renderAllBeginEventSubscriptionAccepted;
        public bool renderAllBeginEventObserved;
        public bool renderAllPendingDefaultDerivedFromFreshRenderer;
        public bool renderAllPendingTrueRequestedBeforeLoad;
        public bool renderAllActiveTrueObservedAfterLoad;
        public bool renderAllPendingFalseResetAttempted;
        public bool renderAllPendingFalseResetCallCompleted;
        public bool renderAllPendingResetReadbackAvailable;
        public string renderAllIsolationBoundary;
    }

    internal sealed class RasterStatisticsReceipt
    {
        public long pixelCount;
        public long nonBlackPixelCount;
        public double nonBlackPixelFraction;
        public int minimumRed;
        public int maximumRed;
        public int minimumGreen;
        public int maximumGreen;
        public int minimumBlue;
        public int maximumBlue;
        public int maximumChannelDynamicRange;
        public int distinctRgbLowerBound;
        public bool distinctRgbCountCapped;
        public double meanLuminance;
        public double luminanceStandardDeviation;
        public string rgb24Sha256;
        public bool nonDegenerateVerified;
    }

    internal sealed class SnapFrameRenderTextureObservationReceipt
    {
        public int observationFrame;
        public int instanceId;
        public bool isLive;
        public bool isCreated;
        public int width;
        public int height;
        public int depth;
        public int antiAliasing;
        public string colorFormat;
        public string graphicsFormat;
        public bool sRgb;
        public bool useMipMap;
        public bool autoGenerateMips;
    }

    internal sealed class SnapFrameDirtyObservationReceipt
    {
        public int observationFrame;
        public bool dirty;
    }

    internal sealed class SnapFrameReadbackReceipt
    {
        public bool renderTextureActiveWasNullBeforeReadback;
        public int renderTextureActiveBeforeReadbackInstanceId;
        public int renderTextureActiveBoundForReadbackInstanceId;
        public bool activeFrameRenderTextureVerifiedBeforeReadPixels;
        public bool firstPartyReadPixelsCompleted;
        public bool firstPartyApplyCompleted;
        public bool renderTextureActiveWasNullAfterReadback;
        public int renderTextureActiveAfterReadbackInstanceId;
        public bool renderTextureActiveRestored;
        public int firstPartyTextureInstanceId;
        public string firstPartyTextureFormat;
        public bool firstPartyTextureReadable;
        public bool firstPartyTextureNoMipChain;
        public bool firstPartyTextureDistinctFromVendorFrameRenderTexture;
        public bool vendorFrameRenderTextureDestroyRequested;
    }

    internal sealed class SnapFrameCameraCallbackReceipt
    {
        public int sequence;
        public string callback;
        public string stage;
        public int frame;
        public double realtimeSeconds;
        public bool cameraMatchesExactSceneCamera;
        public bool targetTextureNull;
        public bool poseMatchesStage;
        public bool projectionMatchesExactProfile;
        public bool frameDirty;
        public int frameRenderTextureInstanceId;
        public double[] position;
        public double[] rotationXyzw;
        public double[] worldToCameraMatrixColumnMajor;
        public double[] projectionMatrixColumnMajor;
    }

    internal sealed class SnapFrameCanvasReceipt
    {
        public int instanceId;
        public string name;
        public string renderMode;
        public int layer;
        public string layerName;
        public int worldCameraInstanceId;
        public bool worldCameraMatchesSceneCamera;
        public bool layerIncludedBySceneCamera;
        public bool canRenderThroughSceneCamera;
    }

    internal sealed class UrpRendererFeatureReceipt
    {
        public int featureIndex;
        public bool present;
        public string name;
        public string typeFullName;
        public int instanceId;
        public bool active;
        public bool snapFrameCaptureFeatureType;
        public bool matchesSnapFrameStaticInstance;
    }

    internal sealed class UrpRendererDataReceipt
    {
        public int rendererDataIndex;
        public bool present;
        public string name;
        public string typeFullName;
        public int instanceId;
        public bool useNativeRenderPass;
        public int featureCount;
        public int snapFrameCaptureFeatureCount;
        public List<UrpRendererFeatureReceipt> features;
    }

    internal sealed class UrpRendererInstanceReceipt
    {
        public int rendererIndex;
        public bool present;
        public string typeFullName;
        public int runtimeIdentityHashCode;
    }

    internal sealed class UrpRendererInventoryReceipt
    {
        public string observationApi;
        public int observationFrame;
        public double observationRealtimeSeconds;
        public bool publicGettersOnly;
        public bool mutationApiInvoked;
        public string[] prohibitedMutationApis;
        public bool currentRenderPipelineAssetPresent;
        public string currentRenderPipelineAssetName;
        public string currentRenderPipelineAssetTypeFullName;
        public int currentRenderPipelineAssetInstanceId;
        public bool currentRenderPipelineAssetIsUniversal;
        public bool universalAdditionalCameraDataPresent;
        public int rendererDataCount;
        public int rendererInstanceCount;
        public bool rendererDataAndInstanceCountsMatch;
        public List<UrpRendererDataReceipt> rendererData;
        public List<UrpRendererInstanceReceipt> rendererInstances;
        public int snapFrameCaptureFeatureCount;
        public int activeSnapFrameCaptureFeatureCount;
        public bool snapFrameStaticInstancePresent;
        public int snapFrameStaticInstanceId;
        public string snapFrameStaticInstanceTypeFullName;
        public int snapFrameStaticInstanceMatchedConfiguredFeatureCount;
        public bool snapFrameStaticInstanceStableDuringSynchronousInventory;
        public bool sceneCameraRendererIndexInferred;
        public int sceneCameraRendererIndex;
        public string sceneCameraRendererIndexProvenance;
        public bool rendererObjectIdentityStableDuringSynchronousInventory;
        public bool rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory;
        public bool mutationObservedDuringSynchronousInventory;
    }

    internal sealed class SnapFrameSurfaceReceipt
    {
        public bool featurePresent;
        public string featureTypeFullName;
        public int featureInstanceId;
        public bool featureStaticInstanceMatched;
        public bool featureBaseActiveBefore;
        public bool featureBaseActiveAfter;
        public bool sceneCameraLive;
        public int sceneCameraInstanceId;
        public bool featureTargetCameraLiveBefore;
        public int featureTargetCameraInstanceIdBefore;
        public bool featureTargetCameraLiveAtReadback;
        public int featureTargetCameraInstanceIdAtReadback;
        public bool featureTargetCameraLiveAfter;
        public int featureTargetCameraInstanceIdAfter;
        public bool featureTargetUnchanged;
        public bool sceneCameraTargetTextureNullBefore;
        public bool sceneCameraTargetTextureNullAfterDirtyRequest;
        public bool sceneCameraTargetTextureNullBeforeReadback;
        public bool sceneCameraTargetTextureNullAfter;
        public bool captureViewAbsentBefore;
        public bool captureViewAbsentAfterDirtyRequest;
        public bool captureViewAbsentBeforeReadback;
        public bool captureViewAbsentAfter;
        public int knownActiveCaptureOverlayCount;
        public string[] knownActiveCaptureOverlayNames;
        public List<SnapFrameCanvasReceipt> activeCanvases;
        public bool unsafeRenderThroughCanvasObserved;
        public string graphicsDeviceType;
        public bool graphicsUvStartsAtTop;
        public string activeColorSpace;
        public string readPixelsCoordinateOrigin;
        public string cpuRowTransform;
        public int sceneCameraPixelWidth;
        public int sceneCameraPixelHeight;
        public int screenWidth;
        public int screenHeight;
        public int sceneCameraCullingMask;
        public int sceneCameraCullingMaskAfter;
        public int sceneCameraTargetDisplay;
        public int sceneCameraTargetDisplayAfter;
        public float sceneCameraDepth;
        public float[] sceneCameraRect;
        public float[] sceneCameraRectAfter;
        public float[] sceneCameraPixelRect;
        public float[] sceneCameraPixelRectAfter;
        public bool cameraConfigurationUnchanged;
        public bool cleanViewStateVerifiedAtEveryCheckpoint;
        public bool universalAdditionalCameraDataPresent;
        public string universalCameraRenderType;
        public int universalCameraStackCount;
        public bool universalRenderPostProcessing;
        public string frameSurfaceProvenance;
        public SnapFrameRenderTextureObservationReceipt frameRenderTextureBefore;
        public SnapFrameRenderTextureObservationReceipt frameRenderTextureAfterDirtyRequest;
        public SnapFrameRenderTextureObservationReceipt frameRenderTextureBeforeReadback;
        public SnapFrameRenderTextureObservationReceipt frameRenderTextureAfter;
        public SnapFrameDirtyObservationReceipt dirtyBeforeRequest;
        public SnapFrameDirtyObservationReceipt dirtyAfterRequest;
        public SnapFrameDirtyObservationReceipt dirtyBeforeReadback;
        public SnapFrameDirtyObservationReceipt dirtyAfterCompletion;
        public double[] exactPositionBefore;
        public double[] exactRotationXyzwBefore;
        public double[] exactWorldToCameraMatrixColumnMajorBefore;
        public double[] exactProjectionMatrixColumnMajorBefore;
        public double[] sentinelPosition;
        public double[] sentinelRotationXyzw;
        public double[] sentinelWorldToCameraMatrixColumnMajor;
        public double[] exactPositionAfter;
        public double[] exactRotationXyzwAfter;
        public double[] exactWorldToCameraMatrixColumnMajorAfter;
        public double[] exactProjectionMatrixColumnMajorAfter;
        public bool sentinelPoseReached;
        public SnapFrameReadbackReceipt sentinelReadback;
        public RasterStatisticsReceipt sentinelRaster;
        public string exactFrameRgb24Sha256;
        public bool sentinelAndExactRgbDiffer;
        public bool exactRestoreVerified;
        public bool cameraCallbackSubscriptionRemoved;
        public int beginCameraRenderingCallbackCount;
        public int endCameraRenderingCallbackCount;
        public bool callbackHistoryOverflowed;
        public bool everyCameraCallbackMatchedStagePose;
        public bool baselineExactEndCallbackVerified;
        public bool sentinelEndCallbackVerified;
        public bool restoredExactEndCallbackVerified;
        public bool stableExactEndCallbackVerified;
        public List<SnapFrameCameraCallbackReceipt> cameraCallbacks;
        public SnapFrameReadbackReceipt readback;
    }

    internal sealed class CaptureAttemptReceipt
    {
        public int ordinal;
        public string status;
        public string sha256;
        public long byteLength;
        public int width;
        public int height;
        public int consecutiveIdenticalHashes;
        public double elapsedSeconds;
        public int srpEndCameraRenderingCallbackCount;
        public int firstSrpEndCameraRenderingFrame;
        public int lastSrpEndCameraRenderingFrame;
        public bool standardCameraRenderCallbackProofAvailable;
        public bool firstPartyReadPixelsCompleted;
        public bool firstPartyApplyCompleted;
        public int firstPartyTextureInstanceId;
        public string firstPartyTextureFormat;
        public bool firstPartyTextureReadable;
        public bool firstPartyTextureNoMipChain;
        public SnapFrameSurfaceReceipt snapFrameSurface;
        public string pixelSource;
        public string readbackTrigger;
        public bool captureTaskCompletedBeforeDeadline;
        public bool captureTaskStopObserved;
        public bool captureTaskTimeoutObserved;
        public bool underlyingCaptureCancellationAvailable;
        public bool pixelReadCompleted;
        public RasterStatisticsReceipt raster;
        public bool pngEncodingCompleted;
        public long encodedByteLength;
        public string encodedSha256;
        public bool postWriteFileShaVerified;
        public string failureType;
        public string failureMessage;
    }

    internal sealed class CaptureReceipt
    {
        public string surface;
        public string imageFormat;
        public int width;
        public int height;
        public bool uiComposited;
        public bool recordModeEnabled;
        public bool gridHidden;
        public bool sceneGizmoHidden;
        public bool trajectoryHidden;
        public int requiredConsecutiveIdenticalHashes;
        public int maximumAttempts;
        public double maximumConvergenceSeconds;
        public int minimumReadinessFrames;
        public double minimumReadinessSeconds;
        public double maximumReadinessSeconds;
        public int observedReadinessFrames;
        public double observedReadinessSeconds;
        public int framesBetweenCaptureAttempts;
        public double sceneLoadTimeoutSeconds;
        public double perCaptureTimeoutSeconds;
        public string perCaptureTimeoutSemantics;
        public bool perCaptureTimeoutCanPreemptBlockedUnityMainThread;
        public bool lateResultObserverCompletionAwaitedBeforeProcessExit;
        public string hardTerminationBoundary;
        public string renderQuality;
        public bool ultraQualityVerified;
        public string vendorFullRenderBudgetPredicate;
        public bool vendorFullRenderBudgetEligible;
        public bool vendorFullRenderBudgetEligibilityUsedForAdmission;
        public bool renderAllRequested;
        public bool renderAllObservedAfterRequest;
        public bool renderAllRequestedBeforeSceneLoad;
        public bool renderAllObservedAfterSceneLoad;
        public bool renderAllVerifiedAtEveryGate;
        public bool canonicalPackageHasEnvironment;
        public bool environmentDataIncluded;
        public bool environmentExclusionRequested;
        public string environmentExclusionReason;
        public bool environmentVisibilityGetterAvailable;
        public bool rendererReadinessContractSatisfied;
        public string renderCallbackSurface;
        public bool globalCameraCallbackRequiredForAdmission;
        public bool standardCameraRenderCallbackProofAvailable;
        public string pipelineAssetType;
        public string configuredPixelSource;
        public string observedPixelSource;
        public bool everyObservedPixelSourceMatchesConfigured;
        public int blackChannelThreshold;
        public double minimumNonBlackPixelFraction;
        public int minimumMaximumChannelDynamicRange;
        public int minimumDistinctRgbCount;
        public double minimumLuminanceStandardDeviation;
        public bool everyAttemptDecodedAndNonDegenerate;
        public double elapsedSeconds;
        public int completedAttempts;
        public List<CaptureAttemptReceipt> attempts;
        public UrpRendererInventoryReceipt urpRendererInventory;
        public string selectedAttemptPath;
        public string finalPngPath;
        public long finalPngByteLength;
        public string finalPngSha256;
        public int stableConsecutiveIdenticalHashes;
        public bool sameHostHashPlateauVerified;
    }

    internal sealed class HostReceipt
    {
        public string machineName;
        public string operatingSystem;
        public string processorType;
        public int processorCount;
        public int systemMemoryMegabytes;
        public string graphicsDeviceName;
        public string graphicsDeviceVendor;
        public string graphicsDeviceVersion;
        public string graphicsDeviceType;
        public int graphicsMemoryMegabytes;
        public bool graphicsMultiThreaded;
    }

    internal sealed class FailureReceipt
    {
        public string exceptionType;
        public string message;
        public string stackTrace;
    }

    internal sealed class NativeCaptureReceipt
    {
        public string schemaVersion;
        public string status;
        public string authority;
        public string truthClass;
        public string roomRef;
        public string runStartedAtUtc;
        public string runCompletedAtUtc;
        public VendorReceipt vendor;
        public ModuleReceipt module;
        public InputReceipt input;
        public CameraProfileReceipt cameraProfile;
        public SceneLoadReceipt sceneLoad;
        public CameraReceipt camera;
        public CaptureReceipt capture;
        public HostReceipt host;
        public string[] limitations;
        public FailureReceipt failure;
    }
}
