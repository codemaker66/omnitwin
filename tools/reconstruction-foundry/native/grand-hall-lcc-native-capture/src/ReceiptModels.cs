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

    internal sealed class CaptureAttemptReceipt
    {
        public int ordinal;
        public string sha256;
        public long byteLength;
        public int width;
        public int height;
        public int consecutiveIdenticalHashes;
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
        public bool fullRenderSupported;
        public bool renderAllRequested;
        public bool renderAllVerifiedAtEveryGate;
        public bool canonicalPackageHasEnvironment;
        public bool environmentVisibilityRequested;
        public bool environmentVisibilityGetterAvailable;
        public bool rendererReadinessContractSatisfied;
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
        public CameraReceipt camera;
        public CaptureReceipt capture;
        public HostReceipt host;
        public string[] limitations;
        public FailureReceipt failure;
    }
}
