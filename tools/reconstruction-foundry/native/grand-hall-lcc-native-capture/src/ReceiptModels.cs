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
        public bool beforeRenderCallbackInvoked;
        public bool afterRenderCallbackInvoked;
        public bool renderProbeSubscriptionRemoved;
        public bool renderTargetAssignedBeforeCapture;
        public int renderTargetInstanceId;
        public int renderTargetWidth;
        public int renderTargetHeight;
        public bool renderTargetDriftObserved;
        public int exactCameraRenderCallbackCount;
        public int firstExactCameraRenderFrame;
        public int lastExactCameraRenderFrame;
        public bool captureTaskCompletedBeforeDeadline;
        public bool captureTaskTimeoutObserved;
        public bool lateCaptureTaskObserverAttached;
        public bool underlyingCaptureCancellationAvailable;
        public string textureFormat;
        public bool textureReadable;
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
        public int blackChannelThreshold;
        public double minimumNonBlackPixelFraction;
        public int minimumMaximumChannelDynamicRange;
        public int minimumDistinctRgbCount;
        public double minimumLuminanceStandardDeviation;
        public bool everyAttemptDecodedAndNonDegenerate;
        public double elapsedSeconds;
        public int completedAttempts;
        public List<CaptureAttemptReceipt> attempts;
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
