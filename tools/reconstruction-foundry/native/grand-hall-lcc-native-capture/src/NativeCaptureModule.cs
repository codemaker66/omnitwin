using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using Cysharp.Threading.Tasks;
using Newtonsoft.Json;
using UnityEngine;
using XGrids.LCCWorld.Framework;
using Debug = UnityEngine.Debug;

namespace Venviewer.NativeCapture
{
    public sealed class NativeCaptureModule : IModule
    {
        private const string ModuleId = "com.venviewer.native_capture";
        private const string ModuleVersion = "1.1.1";
        private const string OutputDirectoryEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_OUTPUT_DIR";
        private const string ModuleShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_MODULE_SHA256";
        private const string ManifestShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_PLUGIN_SHA256";
        private const string RuntimeClosureShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_RUNTIME_CLOSURE_SHA256";
        private const string EditorRootEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_EDITOR_ROOT";
        private const string ArmEnvironmentVariable = "VENVIEWER_LCC_NATIVE_CAPTURE_ARM";
        private const string AutoQuitEnvironmentVariable = "VENVIEWER_LCC_NATIVE_CAPTURE_AUTO_QUIT";
        private const string ExpectedUnityVersion = "6000.0.60f1";
        private const string ReceiptFileName = "grand-hall-native-capture-receipt.json";
        private const string FailureReceiptFileName = "grand-hall-native-capture-failure-receipt.json";
        private const string FinalPngFileName = "grand-hall-native-capture-1600x900.png";

        private static readonly LockedRuntimeFile[] LockedRuntimeFiles =
        {
            new LockedRuntimeFile(
                "LCCEditor.exe",
                "5207BDF9A8C51B5CD653DFEDDBCF5ADEC1BB2E973F0990668BF4696F5AD850A9"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\LCCWorld.dll",
                "4A73BEFBB6517B15A0BE23B3F32D4F60EFAA593A414CE6CC3B3EA921BE0F084D"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\LCCSDK.dll",
                "C02359FA2A7695C59B6A295E00C4383E0C576B8BC74585E68C05ECDF02A20BAE"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\LCCWorld.Common.dll",
                "CC166D8396D462A1EE27C308855DDADF7010E58FD185276D78645490A747EFC2"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\UnityEngine.dll",
                "8E0825F89A43C81E3501A4CDA9B4EAEDEFFC166E449E526884C33411A7A6825A"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\UnityEngine.CoreModule.dll",
                "4FB767E950977C4600E85CB4358F399DC283DB4262A8342A966C73E2EF9AE811"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\UniTask.dll",
                "0DCC2A27BFEF118AE85AB448F4BDFCDA2906894EFB90A951FB2EC06A6FCC07B8"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\Cinemachine.dll",
                "BAA429BD83B01FA9D02DF058B5921D87D98536E28F73ACF0089946016ED7EC5B"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\Newtonsoft.Json.dll",
                "A56146202232958F46BD6A28B5A7DA166AEA123EE0D646735A46E5C341DFBF1F"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\netstandard.dll",
                "6AE62E082DC494A2433984177F60CA4DB5FAE69B1F360A8B33754172B310B8C5")
        };

        private IEventBus _eventBus;
        private ICameraService _cameraService;
        private ISceneManager _sceneManager;
        private ILCCSceneManager _lccSceneManager;
        private ICaptureManager _captureManager;
        private IRendererQualityService _rendererQualityService;
        private Func<EventArg<string>, bool> _sceneLoadedHandler;
        private string _modulePath;
        private string _outputDirectory;
        private string _expectedModuleSha256;
        private string _expectedManifestSha256;
        private string _expectedRuntimeClosureSha256;
        private string _editorRoot;
        private RenderQualityType _originalQuality;
        private bool _qualityCaptured;
        private bool _subscribed;
        private PackageSnapshot _preLoadPackageSnapshot;
        private RuntimeClosureReceipt _preLoadRuntimeClosure;
        private bool _armed;
        private int _started;

        public string Id { get { return ModuleId; } }
        public string Name { get { return "Venviewer Grand Hall native capture"; } }
        public string Version { get { return ModuleVersion; } }
        public bool Dirty { get { return false; } }

        public void Init(IContainer container, string modulePath)
        {
            if (container == null)
            {
                throw new ArgumentNullException("container");
            }

            _modulePath = CapturePolicy.NormalizePath(modulePath);
            _eventBus = container.Resolve<IEventBus>();
            _cameraService = container.Resolve<ICameraService>();
            _sceneManager = container.Resolve<ISceneManager>();
            _lccSceneManager = container.Resolve<ILCCSceneManager>();
            _captureManager = container.Resolve<ICaptureManager>();
            _rendererQualityService = container.Resolve<IRendererQualityService>();
            _sceneLoadedHandler = HandleSceneLoaded;
        }

        public void Execute()
        {
            string arm = Environment.GetEnvironmentVariable(ArmEnvironmentVariable);
            if (String.IsNullOrEmpty(arm))
            {
                Debug.Log("[VenviewerNativeCapture] Module is installed but not armed; no action was taken.");
                return;
            }

            if (!String.Equals(arm, CapturePolicy.ArmValue, StringComparison.Ordinal))
            {
                Debug.LogError("[VenviewerNativeCapture] Refusing an unknown arming value.");
                return;
            }

            _armed = true;
            try
            {
                ValidateResolvedServices();
                if (_lccSceneManager.IsSceneLoaded())
                {
                    throw new InvalidOperationException(
                        "The armed module requires a fresh process with no scene loaded before its pre-load snapshots.");
                }

                ValidateLaunchEnvironment();
                _preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage(
                    CapturePolicy.CanonicalScenePath);
                ConfigureUltraQuality();
                _subscribed = _eventBus.Subscribe("lccscene.loaded", _sceneLoadedHandler, 100);
                if (!_subscribed)
                {
                    throw new InvalidOperationException("The lccscene.loaded subscription was rejected.");
                }

                WatchSceneLoadAsync().Forget(HandleUnhandledException, true);
            }
            catch (Exception exception)
            {
                FailArmedStartup(exception);
            }
        }

        public void Stop()
        {
            if (_subscribed && _eventBus != null && _sceneLoadedHandler != null)
            {
                _eventBus.Unsubscribe("lccscene.loaded", _sceneLoadedHandler);
                _subscribed = false;
            }
        }

        public void Dispose()
        {
            Stop();
        }

        private void ValidateResolvedServices()
        {
            if (_eventBus == null || _cameraService == null || _sceneManager == null ||
                _lccSceneManager == null || _captureManager == null || _rendererQualityService == null)
            {
                throw new InvalidOperationException(
                    "One or more required public LCCEditor services could not be resolved.");
            }
        }

        private void ValidateLaunchEnvironment()
        {
            if (!String.Equals(
                Environment.GetEnvironmentVariable(AutoQuitEnvironmentVariable),
                "1",
                StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    AutoQuitEnvironmentVariable + " must be exactly '1' for deterministic unattended capture.");
            }

            string actualEditorRoot = CapturePolicy.NormalizePath(Path.Combine(Application.dataPath, ".."));
            _editorRoot = CapturePolicy.RequireApprovedSandboxEditorRoot(
                actualEditorRoot,
                Environment.GetEnvironmentVariable(EditorRootEnvironmentVariable));
            CapturePolicy.RequireTreeWithoutReparsePoints(
                _editorRoot,
                "approved disposable editor tree");
            _outputDirectory = CapturePolicy.RequireEmptySafeOutputDirectory(
                Environment.GetEnvironmentVariable(OutputDirectoryEnvironmentVariable),
                _editorRoot);
            _expectedModuleSha256 = CapturePolicy.RequireSha256(
                Environment.GetEnvironmentVariable(ModuleShaEnvironmentVariable),
                ModuleShaEnvironmentVariable);
            _expectedManifestSha256 = CapturePolicy.RequireSha256(
                Environment.GetEnvironmentVariable(ManifestShaEnvironmentVariable),
                ManifestShaEnvironmentVariable);
            _expectedRuntimeClosureSha256 = CapturePolicy.RequireSha256(
                Environment.GetEnvironmentVariable(RuntimeClosureShaEnvironmentVariable),
                RuntimeClosureShaEnvironmentVariable);
            RequireLockedFile(
                Path.Combine(_modulePath, "VenviewerNativeCapture.dll"),
                _expectedModuleSha256,
                "first-party module assembly");
            RequireLockedFile(
                Path.Combine(_modulePath, "plugin.json"),
                _expectedManifestSha256,
                "first-party plugin manifest");
            _preLoadRuntimeClosure = RuntimeClosurePolicy.Verify(
                _editorRoot,
                Path.Combine(_modulePath, "runtime-closure-lock.json"),
                _expectedRuntimeClosureSha256);
        }

        private void ConfigureUltraQuality()
        {
            _originalQuality = _rendererQualityService.CurrentQuality;
            _qualityCaptured = true;
            if (_originalQuality != RenderQualityType.Ultra)
            {
                _rendererQualityService.SetRenderQualityType(RenderQualityType.Ultra);
            }

            if (_rendererQualityService.CurrentQuality != RenderQualityType.Ultra)
            {
                throw new InvalidOperationException("The public renderer-quality service did not enter Ultra mode.");
            }
        }

        private async UniTask WatchSceneLoadAsync()
        {
            var stopwatch = Stopwatch.StartNew();
            while (Volatile.Read(ref _started) == 0 &&
                stopwatch.Elapsed.TotalSeconds < CapturePolicy.SceneLoadTimeoutSeconds)
            {
                await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            }

            if (Interlocked.CompareExchange(ref _started, 1, 0) == 0)
            {
                FailArmedStartupCore(new TimeoutException(
                    "The canonical scene did not publish lccscene.loaded within " +
                    CapturePolicy.SceneLoadTimeoutSeconds.ToString("R", CultureInfo.InvariantCulture) +
                    " seconds."));
            }
        }

        private void FailArmedStartup(Exception exception)
        {
            Interlocked.Exchange(ref _started, 1);
            FailArmedStartupCore(exception);
        }

        private void FailArmedStartupCore(Exception exception)
        {
            Debug.LogException(exception);
            try
            {
                if (_qualityCaptured && _rendererQualityService != null &&
                    _rendererQualityService.CurrentQuality != _originalQuality)
                {
                    _rendererQualityService.SetRenderQualityType(_originalQuality);
                }
            }
            catch (Exception restoreException)
            {
                Debug.LogException(restoreException);
            }

            if (!String.IsNullOrEmpty(_outputDirectory))
            {
                var receipt = CreateInitialReceipt(DateTime.UtcNow);
                SetFailure(receipt, exception, "Armed startup failed: ");
                receipt.runCompletedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                try
                {
                    WriteReceipt(receipt);
                }
                catch (Exception receiptException)
                {
                    Debug.LogException(receiptException);
                }
            }

            Application.Quit(2);
        }

        private bool HandleSceneLoaded(EventArg<string> eventData)
        {
            string scenePath = eventData == null ? null : eventData.t;
            StartCapture(scenePath);
            return true;
        }

        private void StartCapture(string scenePath)
        {
            if (!_armed || Interlocked.CompareExchange(ref _started, 1, 0) != 0)
            {
                return;
            }

            RunCaptureAsync(scenePath).Forget(HandleUnhandledException, true);
        }

        private async UniTask RunCaptureAsync(string scenePath)
        {
            var receipt = CreateInitialReceipt(DateTime.UtcNow);
            var context = new CaptureRunContext();
            int exitCode = 2;

            try
            {
                await ExecuteCapturePipelineAsync(scenePath, receipt, context);
                exitCode = 0;
            }
            catch (Exception exception)
            {
                await UniTask.SwitchToMainThread();
                SetFailure(receipt, exception, null);
                Debug.LogException(exception);
            }

            try
            {
                RestoreCamera(context.CameraState);
            }
            catch (Exception restoreException)
            {
                exitCode = 2;
                SetFailure(receipt, restoreException, "Capture cleanup failed: ");
                Debug.LogException(restoreException);
            }

            receipt.runCompletedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
            try
            {
                WriteReceipt(receipt);
            }
            catch (Exception receiptException)
            {
                exitCode = 2;
                Debug.LogException(receiptException);
            }
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            Application.Quit(exitCode);
        }

        private async UniTask ExecuteCapturePipelineAsync(
            string scenePath,
            NativeCaptureReceipt receipt,
            CaptureRunContext context)
        {
            CapturePolicy.RequireCanonicalScenePath(scenePath);
            string editorRoot = _editorRoot;
            string executablePath = CapturePolicy.NormalizePath(
                Process.GetCurrentProcess().MainModule.FileName);
            string unityVersion = Application.unityVersion;

            await UniTask.SwitchToThreadPool();
            RuntimeEvidence runtimeEvidence = VerifyRuntimeEvidence(
                editorRoot,
                executablePath,
                unityVersion);
            PackageSnapshot before = CapturePolicy.SnapshotCanonicalPackage(scenePath);
            CapturePolicy.RequireUnchanged(_preLoadPackageSnapshot, before);
            await UniTask.SwitchToMainThread();
            PopulateRuntimeReceipt(receipt, runtimeEvidence, before);

            context.CameraState = CaptureOriginalCameraState();
            ApplyLockedCamera(context.CameraState);
            receipt.camera = context.CameraState.Receipt;
            receipt.capture = CreateInitialCaptureReceipt();
            await WaitForCameraApplication(context.CameraState);
            await WaitForRendererReadiness(receipt.capture, context.CameraState);
            await CaptureUntilConverged(receipt.capture, context.CameraState);

            await UniTask.SwitchToThreadPool();
            PackageSnapshot after = CapturePolicy.SnapshotCanonicalPackage(scenePath);
            CapturePolicy.RequireUnchanged(before, after);
            RuntimeClosureReceipt postCaptureRuntimeClosure = RuntimeClosurePolicy.Verify(
                editorRoot,
                Path.Combine(_modulePath, "runtime-closure-lock.json"),
                _expectedRuntimeClosureSha256);
            RequireSameRuntimeClosure(_preLoadRuntimeClosure, postCaptureRuntimeClosure);
            receipt.vendor.runtimeClosure.preLoadAndPostCaptureIdentityVerified = true;
            FinalizePng(receipt.capture);
            await UniTask.SwitchToMainThread();
            receipt.input = ToInputReceipt(after, true);
            receipt.status = "success";
            receipt.failure = null;
        }

        private void PopulateRuntimeReceipt(
            NativeCaptureReceipt receipt,
            RuntimeEvidence runtimeEvidence,
            PackageSnapshot before)
        {
            receipt.vendor = runtimeEvidence.Vendor;
            receipt.module = runtimeEvidence.Module;
            receipt.input = ToInputReceipt(before, false);
            receipt.host = CreateHostReceipt();
            receipt.vendor.lccSdkReportedVersion = _lccSceneManager.GetLCCSDKVersion();
        }

        private static void SetFailure(
            NativeCaptureReceipt receipt,
            Exception exception,
            string messagePrefix)
        {
            receipt.status = "failed";
            receipt.failure = new FailureReceipt
            {
                exceptionType = exception.GetType().FullName,
                message = (messagePrefix ?? String.Empty) + exception.Message,
                stackTrace = exception.StackTrace
            };
        }

        private NativeCaptureReceipt CreateInitialReceipt(DateTime startedAt)
        {
            return new NativeCaptureReceipt
            {
                schemaVersion = "venviewer.grand-hall.lcc-native-capture-receipt.v1",
                status = "running",
                authority = "none",
                truthClass = "RECONSTRUCTED_DIAGNOSTIC",
                roomRef = "trades-hall/grand-hall",
                runStartedAtUtc = startedAt.ToString("o", CultureInfo.InvariantCulture),
                limitations = new[]
                {
                    "The look target is an inspection-only q05/q95 pose-envelope centre; it is not a calibrated source-camera orientation.",
                    "A native renderer screenshot is diagnostic evidence, not human acceptance of Grand Hall scope, transform, geometry, or architectural truth.",
                    "Three consecutive byte-identical PNGs establish a same-host pixel plateau only after the conservative readiness gate; they do not prove every possible streamed Gaussian is resident.",
                    "The public API exposes Ultra quality and IsRenderAll mode, but no loaded-splat residency count or streaming-completion metric. Readiness therefore also requires a minimum 300 rendered frames and 15 seconds before hash sampling.",
                    "The public API exposes HasEnvironment and a SetEnvironmentData request but no environment-visibility getter; the receipt records that bounded limitation rather than claiming verified visibility.",
                    "The runtime closure hashes every regular file in the disposable editor tree except this first-party module. It does not close over the GPU driver, operating system, CodeMeter service, firmware, or external per-user configuration.",
                    "Pixel hashes are not promised to remain identical across GPU drivers, graphics APIs, Unity builds, or LCCSDK versions.",
                    "The module adds no generated fill, neighboring-room asset, facade asset, window, doorway, or architectural edit; it renders only the locked native _9 package.",
                    "XGRIDS executable and SDK binaries remain vendor software and are not redistributed by this module or its build output."
                }
            };
        }

        private RuntimeEvidence VerifyRuntimeEvidence(
            string editorRoot,
            string executablePath,
            string unityVersion)
        {
            if (!String.Equals(unityVersion, ExpectedUnityVersion, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Unity runtime drifted. Expected " + ExpectedUnityVersion + " but found " + unityVersion + ".");
            }

            string expectedExecutable = CapturePolicy.NormalizePath(Path.Combine(editorRoot, "LCCEditor.exe"));
            if (!String.Equals(executablePath, expectedExecutable, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The capture is not running from the expected disposable LCCEditor root.");
            }

            string expectedModulePath = CapturePolicy.NormalizePath(
                Path.Combine(editorRoot, "Modules", "Venviewer Native Capture"));
            if (!String.Equals(_modulePath, expectedModulePath, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The first-party module is not installed at the locked disposable-editor module path.");
            }

            var lockedFiles = new List<HashReceipt>();
            foreach (LockedRuntimeFile lockedFile in LockedRuntimeFiles)
            {
                string path = CapturePolicy.NormalizePath(Path.Combine(editorRoot, lockedFile.RelativePath));
                lockedFiles.Add(RequireLockedFile(path, lockedFile.Sha256, lockedFile.RelativePath));
            }

            string versionPath = @"F:\LccStudio\build\version.json";
            HashReceipt versionFile = RequireLockedFile(
                versionPath,
                "2319924F84A2391D3DCC83CB453D74C7549F2C2FE6C17E0E825971FDF9A92FE9",
                "XGRIDS installed version.json");
            string versionJson = File.ReadAllText(versionPath);
            if (versionJson.IndexOf("0.15.0.7", StringComparison.Ordinal) < 0)
            {
                throw new InvalidOperationException("The locked XGRIDS install version is not 0.15.0.7.");
            }

            lockedFiles.Add(versionFile);
            string moduleAssemblyPath = CapturePolicy.NormalizePath(
                Path.Combine(_modulePath, "VenviewerNativeCapture.dll"));
            string moduleManifestPath = CapturePolicy.NormalizePath(Path.Combine(_modulePath, "plugin.json"));
            string runtimeClosureLockPath = CapturePolicy.NormalizePath(
                Path.Combine(_modulePath, "runtime-closure-lock.json"));
            HashReceipt moduleAssembly = RequireLockedFile(
                moduleAssemblyPath,
                _expectedModuleSha256,
                "first-party module assembly");
            HashReceipt moduleManifest = RequireLockedFile(
                moduleManifestPath,
                _expectedManifestSha256,
                "first-party plugin manifest");
            RuntimeClosureReceipt runtimeClosure = RuntimeClosurePolicy.Verify(
                editorRoot,
                runtimeClosureLockPath,
                _expectedRuntimeClosureSha256);
            RequireSameRuntimeClosure(_preLoadRuntimeClosure, runtimeClosure);

            return new RuntimeEvidence
            {
                Vendor = new VendorReceipt
                {
                    xgridsInstalledVersion = "0.15.0.7",
                    unityVersion = unityVersion,
                    rendererApplication = executablePath,
                    lockedFiles = lockedFiles,
                    runtimeClosure = runtimeClosure
                },
                Module = new ModuleReceipt
                {
                    id = ModuleId,
                    version = ModuleVersion,
                    assembly = moduleAssembly,
                    manifest = moduleManifest,
                    buildReceiptExpectedAssemblySha256 = _expectedModuleSha256,
                    buildReceiptExpectedManifestSha256 = _expectedManifestSha256
                }
            };
        }

        private static void RequireSameRuntimeClosure(
            RuntimeClosureReceipt before,
            RuntimeClosureReceipt after)
        {
            if (before == null || after == null ||
                before.memberCount != after.memberCount ||
                before.totalByteLength != after.totalByteLength ||
                !String.Equals(
                    before.inventorySha256,
                    after.inventorySha256,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The bounded disposable-editor runtime closure changed after armed startup.");
            }
        }

        private static HashReceipt RequireLockedFile(string path, string expectedSha256, string label)
        {
            var info = new FileInfo(path);
            if (!info.Exists)
            {
                throw new FileNotFoundException("A locked runtime file is missing: " + label, path);
            }

            string sha256 = CapturePolicy.Sha256File(path);
            if (!String.Equals(sha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    label + " hash drifted. Expected " + expectedSha256 + " but found " + sha256 + ".");
            }

            return new HashReceipt
            {
                path = info.FullName,
                byteLength = info.Length,
                sha256 = sha256,
                fileVersion = FileVersionInfo.GetVersionInfo(info.FullName).FileVersion
            };
        }

        private CameraState CaptureOriginalCameraState()
        {
            Camera camera = _sceneManager.SceneCamera;
            if (camera == null || !_lccSceneManager.IsSceneLoaded(CapturePolicy.CanonicalScenePath))
            {
                throw new InvalidOperationException("The canonical LCC is not loaded into a public scene camera.");
            }

            return new CameraState
            {
                Camera = camera,
                InputEnabled = _cameraService.InputEnabled,
                CollisionEnabled = _cameraService.CollisionEnabled,
                SceneCameraInteraction = _sceneManager.SceneCameraInteraction,
                ShowTrajectory = _sceneManager.ShowTrajectory,
                IsGridVisible = _sceneManager.IsGridVisible,
                IsSceneGizmoVisible = _sceneManager.IsSceneGizmoVisible,
                Position = camera.transform.position,
                Rotation = camera.transform.rotation,
                FieldOfView = camera.fieldOfView,
                NearClip = camera.nearClipPlane,
                FarClip = camera.farClipPlane,
                Aspect = camera.aspect,
                Orthographic = camera.orthographic,
                Rect = camera.rect,
                RenderAll = _lccSceneManager.IsRenderAll(),
                HasEnvironment = _lccSceneManager.HasEnvironment
            };
        }

        private void ApplyLockedCamera(CameraState state)
        {
            Camera camera = state.Camera;
            Vector3 sourcePosition = ToUnity(CapturePolicy.SourcePosition);
            Vector3 sourceTarget = ToUnity(CapturePolicy.SourceTarget);
            Vector3 sourceUpEnd = ToUnity(CapturePolicy.SourcePosition + CapturePolicy.SourceUp);
            Vector3 nativePosition = _lccSceneManager.LCCObjectToWorldSpace(sourcePosition);
            Vector3 nativeTarget = _lccSceneManager.LCCObjectToWorldSpace(sourceTarget);
            Vector3 nativeUpEnd = _lccSceneManager.LCCObjectToWorldSpace(sourceUpEnd);
            Vector3 nativeUp = (nativeUpEnd - nativePosition).normalized;
            Vector3 nativeDirection = (nativeTarget - nativePosition).normalized;

            CapturePolicy.RequireApproximatelyEqual(
                "Native camera position",
                ToDouble(nativePosition),
                CapturePolicy.ExpectedNativePosition,
                CapturePolicy.NativeCoordinateTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera target",
                ToDouble(nativeTarget),
                CapturePolicy.ExpectedNativeTarget,
                CapturePolicy.NativeCoordinateTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera up",
                ToDouble(nativeUp),
                CapturePolicy.ExpectedNativeUp,
                CapturePolicy.NativeCoordinateTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera direction",
                ToDouble(nativeDirection),
                CapturePolicy.ExpectedNativeDirection,
                CapturePolicy.NativeCoordinateTolerance);

            Quaternion rotation = Quaternion.LookRotation(nativeDirection, nativeUp);
            Quaternion expectedRotation = new Quaternion(
                (float)CapturePolicy.ExpectedNativeQuaternionXyzw[0],
                (float)CapturePolicy.ExpectedNativeQuaternionXyzw[1],
                (float)CapturePolicy.ExpectedNativeQuaternionXyzw[2],
                (float)CapturePolicy.ExpectedNativeQuaternionXyzw[3]);
            if (Math.Abs(Quaternion.Dot(rotation, expectedRotation)) < 0.999999)
            {
                throw new InvalidOperationException(
                    "The native camera quaternion does not match the locked raw _9 expectation.");
            }

            RequireUltraFullRenderCapability();
            if (!state.HasEnvironment)
            {
                throw new InvalidOperationException(
                    "The locked canonical package did not expose its expected environment data.");
            }

            _cameraService.InputEnabled = false;
            _cameraService.CollisionEnabled = false;
            _sceneManager.SceneCameraInteraction = false;
            _sceneManager.ShowTrajectory = false;
            _sceneManager.IsGridVisible = false;
            _sceneManager.IsSceneGizmoVisible = false;
            _cameraService.SetTransform(nativePosition, rotation);
            _sceneManager.SceneCameraPosition = nativePosition;
            _sceneManager.SceneCameraRotation = rotation;
            ApplyProjection(camera);
            _lccSceneManager.SetMainCamera(camera);
            _lccSceneManager.SetRecordMode(
                true,
                new Vector2(CapturePolicy.CaptureWidth, CapturePolicy.CaptureHeight),
                CapturePolicy.VerticalFieldOfViewDegrees);
            state.RecordModeEnabled = true;
            _lccSceneManager.SetFOV(
                CapturePolicy.CaptureWidth,
                CapturePolicy.CaptureHeight,
                CapturePolicy.VerticalFieldOfViewDegrees,
                CapturePolicy.AspectRatio);
            _lccSceneManager.SetLockFPS(true);
            state.LockFpsEnabled = true;
            _lccSceneManager.SetRenderAll(true);
            state.RenderAllMutated = true;
            _lccSceneManager.SetEnvironmentData(true);
            state.EnvironmentVisibilityRequested = true;
            ApplyProjection(camera);
            _lccSceneManager.ForceRerenderer();
            state.Receipt = CreateCameraReceipt(
                nativePosition,
                nativeTarget,
                nativeUp,
                nativeDirection,
                rotation,
                _lccSceneManager.LocalToWorldMatrix);
        }

        private static void ApplyProjection(Camera camera)
        {
            camera.orthographic = false;
            camera.fieldOfView = CapturePolicy.VerticalFieldOfViewDegrees;
            camera.nearClipPlane = CapturePolicy.NearClipMetres;
            camera.farClipPlane = CapturePolicy.FarClipMetres;
            camera.aspect = CapturePolicy.AspectRatio;
            camera.rect = new Rect(0.0f, 0.0f, 1.0f, 1.0f);
            camera.ResetProjectionMatrix();
        }

        private async UniTask WaitForCameraApplication(CameraState state)
        {
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            ApplyProjection(state.Camera);
            RequireLockedCameraState(state);
        }

        private async UniTask WaitForRendererReadiness(CaptureReceipt capture, CameraState state)
        {
            var stopwatch = Stopwatch.StartNew();
            int frame = 0;
            while (frame < CapturePolicy.MinimumReadinessFrames ||
                stopwatch.Elapsed.TotalSeconds < CapturePolicy.MinimumReadinessSeconds ||
                !_lccSceneManager.IsRenderAll())
            {
                if (stopwatch.Elapsed.TotalSeconds > CapturePolicy.MaximumReadinessSeconds)
                {
                    throw new TimeoutException(
                        "The native renderer did not satisfy the bounded Ultra/full-render readiness contract.");
                }

                _lccSceneManager.ForceRerenderer();
                await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
                RequireLockedCameraState(state);
                frame += 1;
            }

            capture.observedReadinessFrames = frame;
            capture.observedReadinessSeconds = stopwatch.Elapsed.TotalSeconds;
            capture.rendererReadinessContractSatisfied = true;
        }

        private void RequireLockedCameraState(CameraState state)
        {
            if (state == null || state.Camera == null ||
                !ReferenceEquals(state.Camera, _sceneManager.SceneCamera))
            {
                throw new InvalidOperationException("The public scene camera changed during capture.");
            }

            if (!_lccSceneManager.IsSceneLoaded(CapturePolicy.CanonicalScenePath) ||
                _cameraService.InputEnabled || _cameraService.CollisionEnabled ||
                _sceneManager.SceneCameraInteraction || _sceneManager.ShowTrajectory ||
                _sceneManager.IsGridVisible || _sceneManager.IsSceneGizmoVisible)
            {
                throw new InvalidOperationException(
                    "The canonical scene or one of the clean-view interaction flags drifted during capture.");
            }

            RequireUltraFullRenderCapability();
            if (!_lccSceneManager.IsRenderAll() || !_lccSceneManager.HasEnvironment)
            {
                throw new InvalidOperationException(
                    "Full-render mode or canonical environment availability drifted during capture.");
            }

            CapturePolicy.RequireApproximatelyEqual(
                "Applied scene-camera position",
                ToDouble(state.Camera.transform.position),
                CapturePolicy.ExpectedNativePosition,
                CapturePolicy.NativeCoordinateTolerance);
            if (Math.Abs(Quaternion.Dot(state.Camera.transform.rotation, ToUnityQuaternion(
                CapturePolicy.ExpectedNativeQuaternionXyzw))) < 0.999999)
            {
                throw new InvalidOperationException(
                    "The live scene-camera rotation drifted after the fixed transform was applied.");
            }

            RequireProjectionValue(
                "vertical FOV",
                state.Camera.fieldOfView,
                CapturePolicy.VerticalFieldOfViewDegrees);
            RequireProjectionValue("near clip", state.Camera.nearClipPlane, CapturePolicy.NearClipMetres);
            RequireProjectionValue("far clip", state.Camera.farClipPlane, CapturePolicy.FarClipMetres);
            RequireProjectionValue("aspect", state.Camera.aspect, CapturePolicy.AspectRatio);
            Rect rect = state.Camera.rect;
            if (state.Camera.orthographic ||
                Math.Abs(rect.x) > CapturePolicy.ProjectionTolerance ||
                Math.Abs(rect.y) > CapturePolicy.ProjectionTolerance ||
                Math.Abs(rect.width - 1.0f) > CapturePolicy.ProjectionTolerance ||
                Math.Abs(rect.height - 1.0f) > CapturePolicy.ProjectionTolerance)
            {
                throw new InvalidOperationException("The live scene-camera viewport drifted from full-frame capture.");
            }
        }

        private void RequireUltraFullRenderCapability()
        {
            if (_rendererQualityService.CurrentQuality != RenderQualityType.Ultra ||
                !_rendererQualityService.SupportFullRender(RenderQualityType.Ultra))
            {
                throw new InvalidOperationException(
                    "Ultra quality with public full-render support is required for native evidence capture.");
            }
        }

        private static void RequireProjectionValue(string label, float actual, float expected)
        {
            if (Math.Abs(actual - expected) > CapturePolicy.ProjectionTolerance)
            {
                throw new InvalidOperationException(
                    "The live scene-camera " + label + " drifted. Expected " +
                    expected.ToString("R", CultureInfo.InvariantCulture) + " but found " +
                    actual.ToString("R", CultureInfo.InvariantCulture) + ".");
            }
        }

        private async UniTask CaptureUntilConverged(CaptureReceipt capture, CameraState state)
        {
            var stopwatch = Stopwatch.StartNew();
            string previousHash = null;
            int consecutive = 0;

            for (int ordinal = 1; ordinal <= CapturePolicy.MaximumCaptureAttempts; ordinal += 1)
            {
                if (stopwatch.Elapsed.TotalSeconds > CapturePolicy.MaximumConvergenceSeconds)
                {
                    break;
                }

                _lccSceneManager.ForceRerenderer();
                for (int frame = 0; frame < CapturePolicy.FramesBetweenCaptureAttempts; frame += 1)
                {
                    await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
                    RequireLockedCameraState(state);
                }
                string candidatePath = Path.Combine(
                    _outputDirectory,
                    ".native-candidate-" + ordinal.ToString("D3", CultureInfo.InvariantCulture) + ".png");
                if (File.Exists(candidatePath))
                {
                    throw new IOException("A capture candidate path already exists: " + candidatePath);
                }

                RequireLockedCameraState(state);
                bool captured = await CaptureWithTimeout(candidatePath);
                if (!captured || !File.Exists(candidatePath))
                {
                    throw new IOException("ICaptureManager did not produce capture attempt " + ordinal + ".");
                }

                await UniTask.SwitchToThreadPool();
                CapturePolicy.RequirePngDimensions(
                    candidatePath,
                    CapturePolicy.CaptureWidth,
                    CapturePolicy.CaptureHeight);
                var info = new FileInfo(candidatePath);
                string sha256 = CapturePolicy.Sha256File(candidatePath);
                await UniTask.SwitchToMainThread();

                consecutive = String.Equals(previousHash, sha256, StringComparison.OrdinalIgnoreCase)
                    ? consecutive + 1
                    : 1;
                previousHash = sha256;
                capture.attempts.Add(new CaptureAttemptReceipt
                {
                    ordinal = ordinal,
                    sha256 = sha256,
                    byteLength = info.Length,
                    width = CapturePolicy.CaptureWidth,
                    height = CapturePolicy.CaptureHeight,
                    consecutiveIdenticalHashes = consecutive
                });
                capture.completedAttempts = ordinal;
                capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                capture.stableConsecutiveIdenticalHashes = consecutive;
                PruneOldCandidates(ordinal);

                if (consecutive >= CapturePolicy.RequiredConsecutiveHashes)
                {
                    RequireLockedCameraState(state);
                    capture.renderAllVerifiedAtEveryGate = true;
                    capture.selectedAttemptPath = candidatePath;
                    capture.sameHostHashPlateauVerified = true;
                    return;
                }
            }

            capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
            throw new TimeoutException(
                "The native renderer did not produce three consecutive byte-identical 1600x900 PNGs within " +
                CapturePolicy.MaximumCaptureAttempts.ToString(CultureInfo.InvariantCulture) + " attempts and " +
                CapturePolicy.MaximumConvergenceSeconds.ToString("R", CultureInfo.InvariantCulture) + " seconds.");
        }

        private async UniTask<bool> CaptureWithTimeout(string candidatePath)
        {
            UniTask<bool> captureTask = _captureManager.CaptureToFileAsync(
                candidatePath,
                new Rect(0, 0, CapturePolicy.CaptureWidth, CapturePolicy.CaptureHeight),
                ImageFormat.PNG);
            UniTask timeoutTask = UniTask.Delay(
                TimeSpan.FromSeconds(CapturePolicy.PerCaptureTimeoutSeconds),
                true,
                PlayerLoopTiming.Update,
                CancellationToken.None,
                false);
            (bool captureWon, bool captured) = await UniTask.WhenAny(captureTask, timeoutTask);
            if (!captureWon)
            {
                throw new TimeoutException(
                    "ICaptureManager exceeded the per-capture deadline of " +
                    CapturePolicy.PerCaptureTimeoutSeconds.ToString("R", CultureInfo.InvariantCulture) +
                    " seconds. No retry will be started.");
            }

            return captured;
        }

        private void FinalizePng(CaptureReceipt capture)
        {
            if (!capture.sameHostHashPlateauVerified ||
                String.IsNullOrEmpty(capture.selectedAttemptPath))
            {
                throw new InvalidOperationException("A stable candidate does not exist.");
            }

            string finalPath = Path.Combine(_outputDirectory, FinalPngFileName);
            if (File.Exists(finalPath))
            {
                throw new IOException("The final native capture path already exists: " + finalPath);
            }

            string temporaryPath = Path.Combine(
                _outputDirectory,
                "." + FinalPngFileName + ".tmp-" + Guid.NewGuid().ToString("N"));
            try
            {
                File.Copy(capture.selectedAttemptPath, temporaryPath, false);
                CapturePolicy.RequirePngDimensions(
                    temporaryPath,
                    CapturePolicy.CaptureWidth,
                    CapturePolicy.CaptureHeight);
                if (File.Exists(finalPath))
                {
                    throw new IOException("The final native capture path appeared during finalization.");
                }

                File.Move(temporaryPath, finalPath);
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }

            var info = new FileInfo(finalPath);
            string sha256 = CapturePolicy.Sha256File(finalPath);
            CaptureAttemptReceipt selected = capture.attempts[capture.attempts.Count - 1];
            if (!String.Equals(sha256, selected.sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The final PNG differs from the selected stable candidate.");
            }

            capture.finalPngPath = finalPath;
            capture.finalPngByteLength = info.Length;
            capture.finalPngSha256 = sha256;
        }

        private void PruneOldCandidates(int currentOrdinal)
        {
            int pruneThrough = currentOrdinal - CapturePolicy.RequiredConsecutiveHashes;
            if (pruneThrough < 1)
            {
                return;
            }

            string path = Path.Combine(
                _outputDirectory,
                ".native-candidate-" + pruneThrough.ToString("D3", CultureInfo.InvariantCulture) + ".png");
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        private CaptureReceipt CreateInitialCaptureReceipt()
        {
            return new CaptureReceipt
            {
                surface = "ISceneManager.SceneCamera via ICaptureManager.CaptureToFileAsync(Rect, PNG)",
                imageFormat = "PNG",
                width = CapturePolicy.CaptureWidth,
                height = CapturePolicy.CaptureHeight,
                uiComposited = false,
                recordModeEnabled = true,
                gridHidden = true,
                sceneGizmoHidden = true,
                trajectoryHidden = true,
                requiredConsecutiveIdenticalHashes = CapturePolicy.RequiredConsecutiveHashes,
                maximumAttempts = CapturePolicy.MaximumCaptureAttempts,
                maximumConvergenceSeconds = CapturePolicy.MaximumConvergenceSeconds,
                minimumReadinessFrames = CapturePolicy.MinimumReadinessFrames,
                minimumReadinessSeconds = CapturePolicy.MinimumReadinessSeconds,
                maximumReadinessSeconds = CapturePolicy.MaximumReadinessSeconds,
                framesBetweenCaptureAttempts = CapturePolicy.FramesBetweenCaptureAttempts,
                sceneLoadTimeoutSeconds = CapturePolicy.SceneLoadTimeoutSeconds,
                perCaptureTimeoutSeconds = CapturePolicy.PerCaptureTimeoutSeconds,
                renderQuality = _rendererQualityService.CurrentQuality.ToString(),
                ultraQualityVerified = _rendererQualityService.CurrentQuality == RenderQualityType.Ultra,
                fullRenderSupported = _rendererQualityService.SupportFullRender(RenderQualityType.Ultra),
                renderAllRequested = true,
                renderAllVerifiedAtEveryGate = false,
                canonicalPackageHasEnvironment = _lccSceneManager.HasEnvironment,
                environmentVisibilityRequested = true,
                environmentVisibilityGetterAvailable = false,
                attempts = new List<CaptureAttemptReceipt>()
            };
        }

        private static CameraReceipt CreateCameraReceipt(
            Vector3 nativePosition,
            Vector3 nativeTarget,
            Vector3 nativeUp,
            Vector3 nativeDirection,
            Quaternion nativeRotation,
            Matrix4x4 localToWorld)
        {
            return new CameraReceipt
            {
                cameraId = "source-pose-19890-interior-v1",
                sourcePoseIndex = 19890,
                sourcePoseTimestamp = "1780223098.347440958",
                sourceFrame = "xgrids_lcc_source_z_up",
                nativeFrame = "xgrids_lcceditor_unity_y_up",
                targetDerivation = "pose_q05_q95_horizontal_centre_at_source_pose_height",
                targetCalibrationStatus = "inspection_only_not_calibrated_source_orientation",
                sourcePosition = CapturePolicy.SourcePosition.ToArray(),
                sourceTarget = CapturePolicy.SourceTarget.ToArray(),
                sourceUp = CapturePolicy.SourceUp.ToArray(),
                nativePosition = ToArray(nativePosition),
                nativeTarget = ToArray(nativeTarget),
                nativeUp = ToArray(nativeUp),
                nativeDirection = ToArray(nativeDirection),
                nativeQuaternionXyzw = ToArray(nativeRotation),
                expectedRawNativePosition = CapturePolicy.ExpectedNativePosition.ToArray(),
                expectedRawNativeTarget = CapturePolicy.ExpectedNativeTarget.ToArray(),
                expectedRawNativeUp = CapturePolicy.ExpectedNativeUp.ToArray(),
                expectedRawNativeDirection = CapturePolicy.ExpectedNativeDirection.ToArray(),
                expectedRawNativeQuaternionXyzw = CapturePolicy.ExpectedNativeQuaternionXyzw,
                rawNativeAssertionTolerance = CapturePolicy.NativeCoordinateTolerance,
                lccLocalToWorldMatrixColumnMajor = MatrixToColumnMajor(localToWorld),
                projection = "perspective",
                verticalFieldOfViewDegrees = CapturePolicy.VerticalFieldOfViewDegrees,
                nearClipMetres = CapturePolicy.NearClipMetres,
                farClipMetres = CapturePolicy.FarClipMetres,
                aspect = CapturePolicy.AspectRatio
            };
        }

        private static InputReceipt ToInputReceipt(PackageSnapshot snapshot, bool unchangedVerified)
        {
            return new InputReceipt
            {
                scenePath = snapshot.ScenePath,
                manifestSha256 = CapturePolicy.CanonicalManifestSha256,
                inventorySha256 = snapshot.InventorySha256,
                memberCount = snapshot.Members.Count,
                totalByteLength = snapshot.Members.Sum(member => member.ByteLength),
                members = snapshot.Members.Select(member => new InputMemberReceipt
                {
                    relativePath = member.RelativePath,
                    absolutePath = member.AbsolutePath,
                    byteLength = member.ByteLength,
                    sha256 = member.Sha256,
                    lastWriteTimeUtcTicks = member.LastWriteTimeUtcTicks
                }).ToList(),
                beforeAfterByteIdentityVerified = unchangedVerified,
                beforeAfterTimestampIdentityVerified = unchangedVerified,
                preLoadThroughPostCaptureIdentityVerified = unchangedVerified
            };
        }

        private static HostReceipt CreateHostReceipt()
        {
            return new HostReceipt
            {
                machineName = Environment.MachineName,
                operatingSystem = SystemInfo.operatingSystem,
                processorType = SystemInfo.processorType,
                processorCount = SystemInfo.processorCount,
                systemMemoryMegabytes = SystemInfo.systemMemorySize,
                graphicsDeviceName = SystemInfo.graphicsDeviceName,
                graphicsDeviceVendor = SystemInfo.graphicsDeviceVendor,
                graphicsDeviceVersion = SystemInfo.graphicsDeviceVersion,
                graphicsDeviceType = SystemInfo.graphicsDeviceType.ToString(),
                graphicsMemoryMegabytes = SystemInfo.graphicsMemorySize,
                graphicsMultiThreaded = SystemInfo.graphicsMultiThreaded
            };
        }

        private void RestoreCamera(CameraState state)
        {
            if (state == null)
            {
                return;
            }

            var restoreErrors = new List<Exception>();
            if (state.RecordModeEnabled)
            {
                AttemptRestore(
                    "record mode",
                    delegate
                    {
                        _lccSceneManager.SetRecordMode(
                            false,
                            new Vector2(CapturePolicy.CaptureWidth, CapturePolicy.CaptureHeight),
                            CapturePolicy.VerticalFieldOfViewDegrees);
                        state.RecordModeEnabled = false;
                    },
                    restoreErrors);
            }

            if (state.LockFpsEnabled)
            {
                AttemptRestore(
                    "locked frame rate",
                    delegate
                    {
                        _lccSceneManager.SetLockFPS(false);
                        state.LockFpsEnabled = false;
                    },
                    restoreErrors);
            }

            if (state.EnvironmentVisibilityRequested)
            {
                AttemptRestore(
                    "environment visibility request",
                    delegate
                    {
                        _lccSceneManager.SetEnvironmentData(false);
                        state.EnvironmentVisibilityRequested = false;
                    },
                    restoreErrors);
            }

            if (state.RenderAllMutated)
            {
                AttemptRestore(
                    "render-all mode",
                    delegate
                    {
                        _lccSceneManager.SetRenderAll(state.RenderAll);
                        state.RenderAllMutated = false;
                    },
                    restoreErrors);
            }

            AttemptRestore(
                "camera input flag",
                delegate { _cameraService.InputEnabled = state.InputEnabled; },
                restoreErrors);
            AttemptRestore(
                "camera collision flag",
                delegate { _cameraService.CollisionEnabled = state.CollisionEnabled; },
                restoreErrors);
            AttemptRestore(
                "scene camera interaction flag",
                delegate { _sceneManager.SceneCameraInteraction = state.SceneCameraInteraction; },
                restoreErrors);
            AttemptRestore(
                "trajectory visibility",
                delegate { _sceneManager.ShowTrajectory = state.ShowTrajectory; },
                restoreErrors);
            AttemptRestore(
                "grid visibility",
                delegate { _sceneManager.IsGridVisible = state.IsGridVisible; },
                restoreErrors);
            AttemptRestore(
                "scene gizmo visibility",
                delegate { _sceneManager.IsSceneGizmoVisible = state.IsSceneGizmoVisible; },
                restoreErrors);
            AttemptRestore(
                "camera service transform",
                delegate { _cameraService.SetTransform(state.Position, state.Rotation); },
                restoreErrors);
            AttemptRestore(
                "scene camera position",
                delegate { _sceneManager.SceneCameraPosition = state.Position; },
                restoreErrors);
            AttemptRestore(
                "scene camera rotation",
                delegate { _sceneManager.SceneCameraRotation = state.Rotation; },
                restoreErrors);
            AttemptRestore(
                "Unity camera transform",
                delegate { state.Camera.transform.SetPositionAndRotation(state.Position, state.Rotation); },
                restoreErrors);
            AttemptRestore(
                "camera field of view",
                delegate { state.Camera.fieldOfView = state.FieldOfView; },
                restoreErrors);
            AttemptRestore(
                "camera near clip",
                delegate { state.Camera.nearClipPlane = state.NearClip; },
                restoreErrors);
            AttemptRestore(
                "camera far clip",
                delegate { state.Camera.farClipPlane = state.FarClip; },
                restoreErrors);
            AttemptRestore(
                "camera aspect",
                delegate { state.Camera.aspect = state.Aspect; },
                restoreErrors);
            AttemptRestore(
                "camera projection mode",
                delegate { state.Camera.orthographic = state.Orthographic; },
                restoreErrors);
            AttemptRestore(
                "camera viewport",
                delegate { state.Camera.rect = state.Rect; },
                restoreErrors);
            AttemptRestore(
                "camera projection matrix",
                delegate { state.Camera.ResetProjectionMatrix(); },
                restoreErrors);
            AttemptRestore(
                "renderer quality",
                delegate
                {
                    if (_qualityCaptured && _rendererQualityService.CurrentQuality != _originalQuality)
                    {
                        _rendererQualityService.SetRenderQualityType(_originalQuality);
                        if (_rendererQualityService.CurrentQuality != _originalQuality)
                        {
                            throw new InvalidOperationException(
                                "The original renderer quality could not be restored.");
                        }
                    }
                },
                restoreErrors);

            if (restoreErrors.Count > 0)
            {
                throw new AggregateException("One or more native capture cleanup operations failed.", restoreErrors);
            }
        }

        private static void AttemptRestore(
            string operation,
            Action action,
            ICollection<Exception> restoreErrors)
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                restoreErrors.Add(new InvalidOperationException(
                    "Could not restore " + operation + ".",
                    exception));
            }
        }

        private void WriteReceipt(NativeCaptureReceipt receipt)
        {
            string fileName = String.Equals(receipt.status, "success", StringComparison.Ordinal)
                ? ReceiptFileName
                : FailureReceiptFileName;
            string finalPath = Path.Combine(_outputDirectory, fileName);
            WriteNoReplaceJson(finalPath, receipt);
            string sha256 = CapturePolicy.Sha256File(finalPath);
            WriteNoReplaceText(
                finalPath + ".sha256",
                sha256 + "  " + Path.GetFileName(finalPath) + Environment.NewLine);
            Debug.Log("[VenviewerNativeCapture] Receipt: " + finalPath + " SHA-256 " + sha256);
        }

        private static void WriteNoReplaceJson(string path, NativeCaptureReceipt receipt)
        {
            string json = JsonConvert.SerializeObject(receipt, Formatting.Indented) + Environment.NewLine;
            WriteNoReplaceText(path, json);
        }

        private static void WriteNoReplaceText(string path, string text)
        {
            if (File.Exists(path))
            {
                throw new IOException("Refusing to replace an existing receipt path: " + path);
            }

            string temporaryPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                using (var stream = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                using (var writer = new StreamWriter(stream, new System.Text.UTF8Encoding(false)))
                {
                    writer.Write(text);
                    writer.Flush();
                    stream.Flush(true);
                }

                File.Move(temporaryPath, path);
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
        }

        private static Vector3 ToUnity(Vec3d value)
        {
            return new Vector3((float)value.X, (float)value.Y, (float)value.Z);
        }

        private static Vec3d ToDouble(Vector3 value)
        {
            return new Vec3d(value.x, value.y, value.z);
        }

        private static double[] ToArray(Vector3 value)
        {
            return new[] { (double)value.x, (double)value.y, (double)value.z };
        }

        private static double[] ToArray(Quaternion value)
        {
            return new[] { (double)value.x, (double)value.y, (double)value.z, (double)value.w };
        }

        private static Quaternion ToUnityQuaternion(double[] value)
        {
            return new Quaternion((float)value[0], (float)value[1], (float)value[2], (float)value[3]);
        }

        private static double[] MatrixToColumnMajor(Matrix4x4 value)
        {
            var result = new double[16];
            int index = 0;
            for (int column = 0; column < 4; column += 1)
            {
                for (int row = 0; row < 4; row += 1)
                {
                    result[index] = value[row, column];
                    index += 1;
                }
            }

            return result;
        }

        private static void HandleUnhandledException(Exception exception)
        {
            Debug.LogException(exception);
            Application.Quit(2);
        }

        private sealed class LockedRuntimeFile
        {
            internal LockedRuntimeFile(string relativePath, string sha256)
            {
                RelativePath = relativePath;
                Sha256 = sha256;
            }

            internal string RelativePath { get; private set; }
            internal string Sha256 { get; private set; }
        }

        private sealed class RuntimeEvidence
        {
            internal VendorReceipt Vendor { get; set; }
            internal ModuleReceipt Module { get; set; }
        }

        private sealed class CaptureRunContext
        {
            internal CameraState CameraState { get; set; }
        }

        private sealed class CameraState
        {
            internal Camera Camera;
            internal bool InputEnabled;
            internal bool CollisionEnabled;
            internal bool SceneCameraInteraction;
            internal bool ShowTrajectory;
            internal bool IsGridVisible;
            internal bool IsSceneGizmoVisible;
            internal Vector3 Position;
            internal Quaternion Rotation;
            internal float FieldOfView;
            internal float NearClip;
            internal float FarClip;
            internal float Aspect;
            internal bool Orthographic;
            internal Rect Rect;
            internal bool RecordModeEnabled;
            internal bool LockFpsEnabled;
            internal bool RenderAllMutated;
            internal bool EnvironmentVisibilityRequested;
            internal bool RenderAll;
            internal bool HasEnvironment;
            internal CameraReceipt Receipt;
        }
    }
}
