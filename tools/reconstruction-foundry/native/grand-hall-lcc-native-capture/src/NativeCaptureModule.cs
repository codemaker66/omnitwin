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
using XGrids.LCCWorld.Framework.Model;
using Debug = UnityEngine.Debug;

namespace Venviewer.NativeCapture
{
    public sealed class NativeCaptureModule : IModule
    {
        private const string ModuleId = "com.venviewer.native_capture";
        private const string ModuleVersion = "1.2.3";
        private const string OutputDirectoryEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_OUTPUT_DIR";
        private const string ModuleShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_MODULE_SHA256";
        private const string ManifestShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_PLUGIN_SHA256";
        private const string RuntimeClosureShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_RUNTIME_CLOSURE_SHA256";
        private const string CameraProfileShaEnvironmentVariable =
            "VENVIEWER_LCC_NATIVE_CAPTURE_CAMERA_PROFILE_SHA256";
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
        private IProjectManager _projectManager;
        private ICameraService _cameraService;
        private ISceneManager _sceneManager;
        private ILCCSceneManager _lccSceneManager;
        private ICaptureManager _captureManager;
        private IRendererQualityService _rendererQualityService;
        private Func<IEvent, bool> _modulesLoadedHandler;
        private Func<EventArg<string>, bool> _sceneLoadedHandler;
        private readonly NativeCaptureLifecycleState _lifecycle = new NativeCaptureLifecycleState();
        private LCCRendererHandler _rendererHandler;
        private string _modulePath;
        private string _outputDirectory;
        private string _expectedModuleSha256;
        private string _expectedManifestSha256;
        private string _expectedRuntimeClosureSha256;
        private string _expectedCameraProfileSha256;
        private string _editorRoot;
        private FixedCameraProfile _cameraProfile;
        private RenderQualityType _originalQuality;
        private bool _qualityCaptured;
        private bool _modulesLoadedSubscribed;
        private bool _subscribed;
        private PackageSnapshot _preLoadPackageSnapshot;
        private RuntimeClosureReceipt _preLoadRuntimeClosure;
        private bool _armed;
        private int _started;
        private int _sceneLoadedEventObserved;
        private string _sceneLoadedEventPath;
        private bool _preloadedSceneRejected;
        private bool _freshProjectStateVerified;
        private bool _temporaryProjectCreationSucceeded;
        private bool _projectInitializedVerified;
        private bool _temporaryProjectVerified;
        private bool _currentSceneDataNonNull;
        private bool _generatedLccAssetPresent;
        private string _generatedLccAssetPath;
        private string _generatedLccAssetResolvedPath;
        private bool _defaultSceneLoadAccepted;
        private bool _canonicalSceneLoadedVerified;

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
            _projectManager = container.Resolve<IProjectManager>();
            _cameraService = container.Resolve<ICameraService>();
            _sceneManager = container.Resolve<ISceneManager>();
            _lccSceneManager = container.Resolve<ILCCSceneManager>();
            _captureManager = container.Resolve<ICaptureManager>();
            _rendererQualityService = container.Resolve<IRendererQualityService>();
            _modulesLoadedHandler = HandleModulesLoaded;
            _sceneLoadedHandler = HandleSceneLoaded;
            ValidateResolvedServices();

            _modulesLoadedSubscribed = _eventBus.Subscribe<IEvent>(
                "modules.loaded",
                _modulesLoadedHandler,
                100);
            if (!_modulesLoadedSubscribed)
            {
                throw new InvalidOperationException("The modules.loaded lifecycle subscription was rejected.");
            }

            Debug.Log(
                "[VenviewerNativeCapture] Lifecycle bridge subscribed to exact modules.loaded; " +
                "guarded execution is waiting for the next Unity frame after that event.");
        }

        public void Execute()
        {
            LifecycleExecutionDecision executionDecision = _lifecycle.TryEnterExecution();
            if (executionDecision == LifecycleExecutionDecision.NotReady)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] Execute was requested before the modules.loaded next-frame " +
                    "handoff and was ignored.");
                return;
            }

            if (executionDecision == LifecycleExecutionDecision.Stopped)
            {
                Debug.LogWarning("[VenviewerNativeCapture] Execute was requested after Stop and was ignored.");
                return;
            }

            if (executionDecision == LifecycleExecutionDecision.Duplicate)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] Duplicate Execute request ignored by the Interlocked one-shot guard.");
                return;
            }

            Debug.Log(
                "[VenviewerNativeCapture] Interlocked one-shot Execute guard acquired after modules.loaded " +
                "and one full Unity-frame handoff.");
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
                RequireFreshVendorState();
                _preloadedSceneRejected = true;
                _freshProjectStateVerified = true;

                ValidateLaunchEnvironment();
                _preLoadPackageSnapshot = CapturePolicy.SnapshotCanonicalPackage(
                    CapturePolicy.CanonicalScenePath);
                ConfigureUltraQuality();
                _subscribed = _eventBus.Subscribe("lccscene.loaded", _sceneLoadedHandler, 100);
                if (!_subscribed)
                {
                    throw new InvalidOperationException("The lccscene.loaded subscription was rejected.");
                }

                RequireFreshVendorState();
                _temporaryProjectCreationSucceeded = _projectManager.CreateTemporaryLCCProject(
                    CapturePolicy.CanonicalScenePath);
                if (!_temporaryProjectCreationSucceeded)
                {
                    throw new InvalidOperationException(
                        "IProjectManager.CreateTemporaryLCCProject rejected the canonical GH_1 LCC2 path.");
                }
                ValidateTemporaryProjectState();
                _defaultSceneLoadAccepted = _sceneManager.LoadDefaultScene();
                if (!_defaultSceneLoadAccepted)
                {
                    throw new InvalidOperationException(
                        "ISceneManager.LoadDefaultScene rejected the generated temporary GH_1 project scene.");
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
            _lifecycle.Stop();
            UnsubscribeModulesLoaded();
            UnsubscribeSceneLoaded();
        }

        public void Dispose()
        {
            Stop();
        }

        private bool HandleModulesLoaded(IEvent moduleLoadedEvent)
        {
            if (_lifecycle.IsStopped)
            {
                Debug.LogWarning("[VenviewerNativeCapture] modules.loaded was ignored after Stop.");
                return true;
            }
            if (!_lifecycle.TryScheduleModulesLoaded())
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] Duplicate modules.loaded delivery ignored by the " +
                    "Interlocked one-shot scheduling guard.");
                return true;
            }

            Debug.Log(
                "[VenviewerNativeCapture] Exact modules.loaded observed; deferring one-shot removal until " +
                "the current vendor EventBus dispatch has unwound.");
            ScheduleExecuteAfterModulesLoadedAsync().Forget(HandleUnhandledException, true);
            return true;
        }

        private async UniTask ScheduleExecuteAfterModulesLoadedAsync()
        {
            await UniTask.Yield(PlayerLoopTiming.LastPostLateUpdate);
            if (_lifecycle.IsStopped)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] The modules.loaded handoff was cancelled because Stop ran " +
                    "while the vendor EventBus dispatch was unwinding.");
                return;
            }

            UnsubscribeModulesLoaded();
            Debug.Log(
                "[VenviewerNativeCapture] modules.loaded subscription safely removed after vendor dispatch; " +
                "scheduling Execute for the next Unity frame.");
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            if (!_lifecycle.TryMarkNextFrameExecutionReady())
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] The modules.loaded handoff was cancelled because Stop ran " +
                    "before the next Unity frame.");
                return;
            }

            Debug.Log(
                "[VenviewerNativeCapture] Next Unity frame reached after modules.loaded; invoking guarded Execute now.");
            Execute();
        }

        private void UnsubscribeModulesLoaded()
        {
            if (!_modulesLoadedSubscribed || _eventBus == null || _modulesLoadedHandler == null)
            {
                return;
            }

            bool removed = _eventBus.Unsubscribe<IEvent>("modules.loaded", _modulesLoadedHandler);
            _modulesLoadedSubscribed = false;
            if (!removed)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] modules.loaded unsubscribe reported no matching handler; " +
                    "the Interlocked one-shot guards remain closed to duplicate execution.");
            }
        }

        private void UnsubscribeSceneLoaded()
        {
            if (!_subscribed || _eventBus == null || _sceneLoadedHandler == null)
            {
                return;
            }

            bool removed = _eventBus.Unsubscribe("lccscene.loaded", _sceneLoadedHandler);
            _subscribed = false;
            if (!removed)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] lccscene.loaded unsubscribe reported no matching handler.");
            }
        }

        private void ThrowIfStopped()
        {
            if (_lifecycle.IsStopped)
            {
                throw new OperationCanceledException(
                    "The native capture was stopped before the current operation completed.");
            }
        }

        private void ValidateResolvedServices()
        {
            if (_eventBus == null || _cameraService == null || _sceneManager == null ||
                _lccSceneManager == null || _projectManager == null || _captureManager == null ||
                _rendererQualityService == null || _modulesLoadedHandler == null || _sceneLoadedHandler == null)
            {
                throw new InvalidOperationException(
                    "One or more required public LCCEditor services could not be resolved.");
            }
        }

        private void RequireFreshVendorState()
        {
            if (_projectManager.IsInitialized ||
                _sceneManager.CurrentSceneData != null ||
                _sceneManager.HasLCCAsset ||
                _lccSceneManager.IsSceneLoaded())
            {
                throw new InvalidOperationException(
                    "Native capture requires a fresh vendor process with no project, current scene data, or loaded LCC.");
            }
        }

        private void ValidateTemporaryProjectState()
        {
            _projectInitializedVerified = _projectManager.IsInitialized;
            _temporaryProjectVerified = _projectManager.IsTemporary;
            if (!_projectInitializedVerified || !_temporaryProjectVerified)
            {
                throw new InvalidOperationException(
                    "CreateTemporaryLCCProject did not initialize a temporary vendor project.");
            }
            _currentSceneDataNonNull = _sceneManager.CurrentSceneData != null;
            if (!_currentSceneDataNonNull)
            {
                throw new InvalidOperationException(
                    "CreateTemporaryLCCProject did not generate current scene data.");
            }
            _generatedLccAssetPresent = _sceneManager.HasLCCAsset;
            if (!_generatedLccAssetPresent)
            {
                throw new InvalidOperationException(
                    "The generated temporary scene does not declare an LCC asset.");
            }

            LCCAsset asset;
            if (!_sceneManager.CurrentSceneData.TryGetLCCAsset(out asset) || asset == null ||
                String.IsNullOrWhiteSpace(asset.path))
            {
                throw new InvalidOperationException(
                    "The generated temporary scene did not expose a usable LCC asset path.");
            }

            _generatedLccAssetPath = asset.path;
            _generatedLccAssetResolvedPath = CapturePolicy.NormalizePath(
                _projectManager.GetAssetFinalPath(asset.path));
            CapturePolicy.RequireCanonicalScenePath(_generatedLccAssetResolvedPath);
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
            _expectedCameraProfileSha256 = CapturePolicy.RequireSha256(
                Environment.GetEnvironmentVariable(CameraProfileShaEnvironmentVariable),
                CameraProfileShaEnvironmentVariable);
            if (!String.Equals(
                _expectedCameraProfileSha256,
                CapturePolicy.CameraProfileSha256,
                StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "The operator-declared camera profile SHA-256 does not equal the compiled digest lock.");
            }
            RequireLockedFile(
                Path.Combine(_modulePath, "VenviewerNativeCapture.dll"),
                _expectedModuleSha256,
                "first-party module assembly");
            RequireLockedFile(
                Path.Combine(_modulePath, "plugin.json"),
                _expectedManifestSha256,
                "first-party plugin manifest");
            _cameraProfile = FixedCameraProfile.Load(
                Path.Combine(_modulePath, CapturePolicy.CameraProfileFileName),
                _expectedCameraProfileSha256);
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

            CapturePolicy.RequireUltraQuality(
                _rendererQualityService.CurrentQuality == RenderQualityType.Ultra);
        }

        private async UniTask WatchSceneLoadAsync()
        {
            if (_lifecycle.IsStopped)
            {
                return;
            }

            var stopwatch = Stopwatch.StartNew();
            while (Volatile.Read(ref _started) == 0 &&
                stopwatch.Elapsed.TotalSeconds < CapturePolicy.SceneLoadTimeoutSeconds)
            {
                await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
                if (_lifecycle.IsStopped)
                {
                    return;
                }
            }

            if (_lifecycle.IsStopped)
            {
                return;
            }
            if (Interlocked.CompareExchange(ref _started, 1, 0) == 0)
            {
                FailArmedStartupCore(new TimeoutException(
                    "The high-level default-scene load did not publish the exact canonical lccscene.loaded event within " +
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
            if (_lifecycle.IsStopped)
            {
                Debug.LogWarning("[VenviewerNativeCapture] lccscene.loaded was ignored after Stop.");
                return true;
            }

            try
            {
                if (eventData == null)
                {
                    throw new InvalidOperationException("The lccscene.loaded event supplied a null event argument.");
                }

                string scenePath = eventData.t;
                CapturePolicy.RequireCanonicalScenePath(scenePath);
                _rendererHandler = _lccSceneManager.GetRendererHandlerByPath(
                    CapturePolicy.CanonicalScenePath);
                if (_rendererHandler == null)
                {
                    throw new InvalidOperationException(
                        "The lccscene.loaded event arrived without a canonical renderer handler.");
                }
                CapturePolicy.RequireCanonicalScenePath(_rendererHandler.Path);
                if (!_lccSceneManager.IsSceneLoaded(CapturePolicy.CanonicalScenePath))
                {
                    throw new InvalidOperationException(
                        "The exact canonical GH_1 LCC2 is not loaded after lccscene.loaded.");
                }
                if (Interlocked.Exchange(ref _sceneLoadedEventObserved, 1) != 0)
                {
                    throw new InvalidOperationException("The canonical lccscene.loaded event was published more than once.");
                }

                _sceneLoadedEventPath = CapturePolicy.NormalizePath(scenePath);
                _canonicalSceneLoadedVerified = true;
                TryStartCaptureAfterLoadContract(true);
            }
            catch (Exception exception)
            {
                FailSceneLoadContract(exception);
            }
            return true;
        }

        private void TryStartCaptureAfterLoadContract(bool deferUntilEventDispatchUnwinds)
        {
            if (_lifecycle.IsStopped)
            {
                return;
            }
            if (Volatile.Read(ref _sceneLoadedEventObserved) == 0)
            {
                return;
            }

            CapturePolicy.RequireCanonicalScenePath(_sceneLoadedEventPath);
            CapturePolicy.RequireCanonicalScenePath(_rendererHandler.Path);
            if (!_lccSceneManager.IsSceneLoaded(CapturePolicy.CanonicalScenePath))
            {
                throw new InvalidOperationException(
                    "The canonical event completed but the exact GH_1 LCC2 is not the loaded scene.");
            }

            if (deferUntilEventDispatchUnwinds)
            {
                StartCaptureAfterSceneEventDispatchAsync().Forget(HandleUnhandledException, true);
                return;
            }

            UnsubscribeSceneLoaded();
            StartCapture(CapturePolicy.CanonicalScenePath);
        }

        private async UniTask StartCaptureAfterSceneEventDispatchAsync()
        {
            await UniTask.Yield(PlayerLoopTiming.LastPostLateUpdate);
            if (_lifecycle.IsStopped)
            {
                return;
            }

            UnsubscribeSceneLoaded();
            StartCapture(CapturePolicy.CanonicalScenePath);
        }

        private void FailSceneLoadContract(Exception exception)
        {
            if (Interlocked.CompareExchange(ref _started, 1, 0) == 0)
            {
                FailArmedStartupCore(exception);
                return;
            }

            Debug.LogException(exception);
            Application.Quit(2);
        }

        private void StartCapture(string scenePath)
        {
            if (_lifecycle.IsStopped || !_armed || Interlocked.CompareExchange(ref _started, 1, 0) != 0)
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
                ThrowIfStopped();
                await ExecuteCapturePipelineAsync(scenePath, receipt, context);
                ThrowIfStopped();
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
            ThrowIfStopped();
            CapturePolicy.RequireCanonicalScenePath(scenePath);
            string editorRoot = _editorRoot;
            string executablePath = CapturePolicy.NormalizePath(
                Process.GetCurrentProcess().MainModule.FileName);
            string unityVersion = Application.unityVersion;

            ThrowIfStopped();
            await UniTask.SwitchToThreadPool();
            ThrowIfStopped();
            RuntimeEvidence runtimeEvidence = VerifyRuntimeEvidence(
                editorRoot,
                executablePath,
                unityVersion);
            PackageSnapshot before = CapturePolicy.SnapshotCanonicalPackage(scenePath);
            CapturePolicy.RequireUnchanged(_preLoadPackageSnapshot, before);
            ThrowIfStopped();
            await UniTask.SwitchToMainThread();
            ThrowIfStopped();
            PopulateRuntimeReceipt(receipt, runtimeEvidence, before);

            context.CameraState = CaptureOriginalCameraState();
            ApplyLockedCamera(context.CameraState);
            receipt.camera = context.CameraState.Receipt;
            receipt.capture = CreateInitialCaptureReceipt();
            await WaitForCameraApplication(context.CameraState);
            ThrowIfStopped();
            await WaitForRendererReadiness(receipt.capture, context.CameraState);
            ThrowIfStopped();
            await CaptureUntilConverged(receipt.capture, context.CameraState);
            ThrowIfStopped();

            await UniTask.SwitchToThreadPool();
            ThrowIfStopped();
            PackageSnapshot after = CapturePolicy.SnapshotCanonicalPackage(scenePath);
            ThrowIfStopped();
            CapturePolicy.RequireUnchanged(before, after);
            RuntimeClosureReceipt postCaptureRuntimeClosure = RuntimeClosurePolicy.Verify(
                editorRoot,
                Path.Combine(_modulePath, "runtime-closure-lock.json"),
                _expectedRuntimeClosureSha256);
            ThrowIfStopped();
            RequireSameRuntimeClosure(_preLoadRuntimeClosure, postCaptureRuntimeClosure);
            receipt.vendor.runtimeClosure.preLoadAndPostCaptureIdentityVerified = true;
            ThrowIfStopped();
            FinalizePng(receipt.capture);
            await UniTask.SwitchToMainThread();
            ThrowIfStopped();
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
                schemaVersion = "venviewer.grand-hall.lcc-native-capture-receipt.v3",
                status = "running",
                authority = "none",
                truthClass = "RECONSTRUCTED_DIAGNOSTIC",
                roomRef = "trades-hall/grand-hall",
                runStartedAtUtc = startedAt.ToString("o", CultureInfo.InvariantCulture),
                cameraProfile = CreateCameraProfileReceipt(),
                sceneLoad = CreateSceneLoadReceipt(),
                limitations = new[]
                {
                    "The look target is an inspection-only q05/q95 pose-envelope centre; it is not a calibrated source-camera orientation.",
                    "A native renderer screenshot is diagnostic evidence, not human acceptance of Grand Hall scope, transform, geometry, or architectural truth.",
                    "Three consecutive byte-identical PNGs establish a same-host pixel plateau only after the conservative readiness gate; they do not prove every possible streamed Gaussian is resident.",
                    "The public API exposes Ultra quality and SetRenderAll/IsRenderAll mode, but no loaded-splat residency count or streaming-completion metric. Readiness therefore also requires a minimum 300 rendered frames and 15 seconds before hash sampling.",
                    "In the locked vendor implementation, SupportFullRender(Ultra) is a current-scene splat-budget eligibility predicate, not an API-capability flag. Its false result for this 6,019,684-finest-splat package is recorded as telemetry and is not substituted for the observed IsRenderAll state.",
                    "Environment data is explicitly requested false for browser-frontier parity, excluding env.sog. The public API exposes no environment-visibility getter, so this receipt records the request and does not claim read-back visibility.",
                    "The runtime closure hashes every regular file in the disposable editor tree except this first-party module. It does not close over the GPU driver, operating system, CodeMeter service, firmware, or external per-user configuration.",
                    "Pixel hashes are not promised to remain identical across GPU drivers, graphics APIs, Unity builds, or LCCSDK versions.",
                    "The module adds no generated fill, neighboring-room asset, facade asset, window, doorway, or architectural edit; it renders only the locked native GH_1 LCC2 package.",
                    "XGRIDS executable and SDK binaries remain vendor software and are not redistributed by this module or its build output."
                }
            };
        }

        private CameraProfileReceipt CreateCameraProfileReceipt()
        {
            if (_cameraProfile == null)
            {
                return null;
            }

            return new CameraProfileReceipt
            {
                path = _cameraProfile.Path,
                sha256 = _cameraProfile.Sha256,
                schemaVersion = _cameraProfile.SchemaVersion,
                profileId = _cameraProfile.ProfileId,
                sourceFrame = _cameraProfile.Frames.Source.Id,
                nativeFrame = _cameraProfile.Frames.Native.Id,
                threeFrame = _cameraProfile.Frames.Three.Id,
                inspectionOnly = _cameraProfile.InspectionOnly,
                environmentIncluded = _cameraProfile.Environment.Include,
                environmentExclusionReason = _cameraProfile.Environment.Reason
            };
        }

        private SceneLoadReceipt CreateSceneLoadReceipt()
        {
            return new SceneLoadReceipt
            {
                api = "IProjectManager.CreateTemporaryLCCProject(string) + ISceneManager.LoadDefaultScene()",
                requestedPath = CapturePolicy.CanonicalScenePath,
                commandLineSceneArgumentUsed = false,
                preloadedSceneRejected = _preloadedSceneRejected,
                freshProjectStateVerified = _freshProjectStateVerified,
                temporaryProjectCreationSucceeded = _temporaryProjectCreationSucceeded,
                projectInitializedVerified = _projectInitializedVerified,
                temporaryProjectVerified = _temporaryProjectVerified,
                currentSceneDataNonNull = _currentSceneDataNonNull,
                generatedLccAssetPresent = _generatedLccAssetPresent,
                generatedLccAssetPath = _generatedLccAssetPath,
                generatedLccAssetResolvedPath = _generatedLccAssetResolvedPath,
                generatedLccAssetPathVerified = IsCanonicalScenePath(_generatedLccAssetResolvedPath),
                defaultSceneLoadAccepted = _defaultSceneLoadAccepted,
                eventTopic = "lccscene.loaded",
                eventSubscriptionAccepted = _subscribed || Volatile.Read(ref _sceneLoadedEventObserved) != 0,
                eventPath = _sceneLoadedEventPath,
                eventPathVerified = Volatile.Read(ref _sceneLoadedEventObserved) != 0,
                rendererHandlerNonNull = _rendererHandler != null,
                rendererHandlerPath = _rendererHandler == null ? null : _rendererHandler.Path,
                rendererHandlerPathVerified = _rendererHandler != null && IsCanonicalScenePath(_rendererHandler.Path),
                canonicalSceneLoadedVerified = _canonicalSceneLoadedVerified
            };
        }

        private static bool IsCanonicalScenePath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            try
            {
                CapturePolicy.RequireCanonicalScenePath(path);
                return true;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
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
            Vec3d profileSourcePosition = _cameraProfile.SourcePosition();
            Vec3d profileSourceTarget = _cameraProfile.SourceTarget();
            Vec3d profileSourceUp = _cameraProfile.SourceUp();
            Vector3 sourcePosition = ToUnity(profileSourcePosition);
            Vector3 sourceTarget = ToUnity(profileSourceTarget);
            Vector3 sourceUpEnd = ToUnity(profileSourcePosition + profileSourceUp);
            Vector3 nativePosition = _lccSceneManager.LCCObjectToWorldSpace(sourcePosition);
            Vector3 nativeTarget = _lccSceneManager.LCCObjectToWorldSpace(sourceTarget);
            Vector3 nativeUpEnd = _lccSceneManager.LCCObjectToWorldSpace(sourceUpEnd);
            Vector3 nativeUp = (nativeUpEnd - nativePosition).normalized;
            Vector3 nativeDirection = (nativeTarget - nativePosition).normalized;

            CapturePolicy.RequireApproximatelyEqual(
                "Native camera position",
                ToDouble(nativePosition),
                _cameraProfile.ExpectedNativePosition(),
                _cameraProfile.Frames.Native.AssertionTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera target",
                ToDouble(nativeTarget),
                _cameraProfile.ExpectedNativeTarget(),
                _cameraProfile.Frames.Native.AssertionTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera up",
                ToDouble(nativeUp),
                _cameraProfile.ExpectedNativeUp(),
                _cameraProfile.Frames.Native.AssertionTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "Native camera direction",
                ToDouble(nativeDirection),
                _cameraProfile.ExpectedNativeDirection(),
                _cameraProfile.Frames.Native.AssertionTolerance);

            double[] expectedQuaternion = _cameraProfile.Frames.Native.ExpectedQuaternionXyzw;
            Quaternion rotation = Quaternion.LookRotation(nativeDirection, nativeUp);
            Quaternion expectedRotation = new Quaternion(
                (float)expectedQuaternion[0],
                (float)expectedQuaternion[1],
                (float)expectedQuaternion[2],
                (float)expectedQuaternion[3]);
            if (Math.Abs(Quaternion.Dot(rotation, expectedRotation)) < 0.999999)
            {
                throw new InvalidOperationException(
                    "The native camera quaternion does not match the digest-bound fixed-camera profile.");
            }

            CapturePolicy.RequireUltraQuality(
                _rendererQualityService.CurrentQuality == RenderQualityType.Ultra);
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
                new Vector2(_cameraProfile.Output.Width, _cameraProfile.Output.Height),
                (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees);
            state.RecordModeEnabled = true;
            _lccSceneManager.SetFOV(
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height,
                (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees,
                (float)_cameraProfile.Projection.Aspect);
            _lccSceneManager.SetLockFPS(true);
            state.LockFpsEnabled = true;
            _lccSceneManager.SetRenderAll(true);
            state.RenderAllMutated = true;
            // The locked SupportFullRender implementation is a scene-budget predicate.
            // Only the public renderer-mode read-back can admit this capture lane.
            RequireObservedUltraRenderAll();
            _lccSceneManager.SetEnvironmentData(false);
            state.EnvironmentExclusionRequested = true;
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

        private void ApplyProjection(Camera camera)
        {
            camera.orthographic = false;
            camera.fieldOfView = (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees;
            camera.nearClipPlane = (float)_cameraProfile.Projection.NearClipMetres;
            camera.farClipPlane = (float)_cameraProfile.Projection.FarClipMetres;
            camera.aspect = (float)_cameraProfile.Projection.Aspect;
            camera.rect = new Rect(0.0f, 0.0f, 1.0f, 1.0f);
            camera.ResetProjectionMatrix();
        }

        private async UniTask WaitForCameraApplication(CameraState state)
        {
            ThrowIfStopped();
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            ThrowIfStopped();
            await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
            ThrowIfStopped();
            ApplyProjection(state.Camera);
            RequireLockedCameraState(state);
        }

        private async UniTask WaitForRendererReadiness(CaptureReceipt capture, CameraState state)
        {
            ThrowIfStopped();
            var stopwatch = Stopwatch.StartNew();
            int frame = 0;
            while (frame < CapturePolicy.MinimumReadinessFrames ||
                stopwatch.Elapsed.TotalSeconds < CapturePolicy.MinimumReadinessSeconds ||
                !_lccSceneManager.IsRenderAll())
            {
                ThrowIfStopped();
                if (stopwatch.Elapsed.TotalSeconds > CapturePolicy.MaximumReadinessSeconds)
                {
                    throw new TimeoutException(
                        "The native renderer did not satisfy the bounded Ultra/full-render readiness contract.");
                }

                _lccSceneManager.ForceRerenderer();
                await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
                ThrowIfStopped();
                RequireLockedCameraState(state);
                frame += 1;
            }

            ThrowIfStopped();
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

            RequireObservedUltraRenderAll();
            if (!_lccSceneManager.HasEnvironment)
            {
                throw new InvalidOperationException(
                    "Full-render mode or canonical environment availability drifted during capture.");
            }

            CapturePolicy.RequireApproximatelyEqual(
                "Applied scene-camera position",
                ToDouble(state.Camera.transform.position),
                _cameraProfile.ExpectedNativePosition(),
                _cameraProfile.Frames.Native.AssertionTolerance);
            double[] expectedQuaternion = _cameraProfile.Frames.Native.ExpectedQuaternionXyzw;
            if (Math.Abs(Quaternion.Dot(state.Camera.transform.rotation, ToUnityQuaternion(
                expectedQuaternion))) < 0.999999)
            {
                throw new InvalidOperationException(
                    "The live scene-camera rotation drifted after the fixed transform was applied.");
            }

            RequireProjectionValue(
                "vertical FOV",
                state.Camera.fieldOfView,
                (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees);
            RequireProjectionValue(
                "near clip",
                state.Camera.nearClipPlane,
                (float)_cameraProfile.Projection.NearClipMetres);
            RequireProjectionValue(
                "far clip",
                state.Camera.farClipPlane,
                (float)_cameraProfile.Projection.FarClipMetres);
            RequireProjectionValue("aspect", state.Camera.aspect, (float)_cameraProfile.Projection.Aspect);
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

        private void RequireObservedUltraRenderAll()
        {
            CapturePolicy.RequireObservedUltraRenderAll(
                _rendererQualityService.CurrentQuality == RenderQualityType.Ultra,
                _lccSceneManager.IsRenderAll());
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
            ThrowIfStopped();
            var stopwatch = Stopwatch.StartNew();
            string previousHash = null;
            int consecutive = 0;

            for (int ordinal = 1; ordinal <= CapturePolicy.MaximumCaptureAttempts; ordinal += 1)
            {
                ThrowIfStopped();
                if (stopwatch.Elapsed.TotalSeconds > CapturePolicy.MaximumConvergenceSeconds)
                {
                    break;
                }

                _lccSceneManager.ForceRerenderer();
                for (int frame = 0; frame < CapturePolicy.FramesBetweenCaptureAttempts; frame += 1)
                {
                    ThrowIfStopped();
                    await UniTask.NextFrame(PlayerLoopTiming.LastPostLateUpdate);
                    ThrowIfStopped();
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
                ThrowIfStopped();
                bool captured = await CaptureWithTimeout(candidatePath);
                ThrowIfStopped();
                if (!captured || !File.Exists(candidatePath))
                {
                    throw new IOException("ICaptureManager did not produce capture attempt " + ordinal + ".");
                }

                await UniTask.SwitchToThreadPool();
                ThrowIfStopped();
                CapturePolicy.RequirePngDimensions(
                    candidatePath,
                    _cameraProfile.Output.Width,
                    _cameraProfile.Output.Height);
                var info = new FileInfo(candidatePath);
                string sha256 = CapturePolicy.Sha256File(candidatePath);
                await UniTask.SwitchToMainThread();
                ThrowIfStopped();

                consecutive = String.Equals(previousHash, sha256, StringComparison.OrdinalIgnoreCase)
                    ? consecutive + 1
                    : 1;
                previousHash = sha256;
                capture.attempts.Add(new CaptureAttemptReceipt
                {
                    ordinal = ordinal,
                    sha256 = sha256,
                    byteLength = info.Length,
                    width = _cameraProfile.Output.Width,
                    height = _cameraProfile.Output.Height,
                    consecutiveIdenticalHashes = consecutive
                });
                capture.completedAttempts = ordinal;
                capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                capture.stableConsecutiveIdenticalHashes = consecutive;
                PruneOldCandidates(ordinal);

                if (consecutive >= CapturePolicy.RequiredConsecutiveHashes)
                {
                    ThrowIfStopped();
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
            ThrowIfStopped();
            UniTask<bool> captureTask = _captureManager.CaptureToFileAsync(
                candidatePath,
                new Rect(0, 0, _cameraProfile.Output.Width, _cameraProfile.Output.Height),
                ImageFormat.PNG);
            UniTask timeoutTask = UniTask.Delay(
                TimeSpan.FromSeconds(CapturePolicy.PerCaptureTimeoutSeconds),
                true,
                PlayerLoopTiming.Update,
                CancellationToken.None,
                false);
            (bool captureWon, bool captured) = await UniTask.WhenAny(captureTask, timeoutTask);
            ThrowIfStopped();
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
                    _cameraProfile.Output.Width,
                    _cameraProfile.Output.Height);
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
                width = _cameraProfile.Output.Width,
                height = _cameraProfile.Output.Height,
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
                // Preserve the vendor predicate as telemetry without treating it as API capability.
                vendorFullRenderBudgetPredicate = "SupportFullRender(Ultra)",
                vendorFullRenderBudgetEligible =
                    _rendererQualityService.SupportFullRender(RenderQualityType.Ultra),
                vendorFullRenderBudgetEligibilityUsedForAdmission = false,
                renderAllRequested = true,
                renderAllObservedAfterRequest = _lccSceneManager.IsRenderAll(),
                renderAllVerifiedAtEveryGate = false,
                canonicalPackageHasEnvironment = _lccSceneManager.HasEnvironment,
                environmentDataIncluded = false,
                environmentExclusionRequested = true,
                environmentExclusionReason = _cameraProfile.Environment.Reason,
                environmentVisibilityGetterAvailable = _cameraProfile.Environment.VisibilityGetterAvailable,
                attempts = new List<CaptureAttemptReceipt>()
            };
        }

        private CameraReceipt CreateCameraReceipt(
            Vector3 nativePosition,
            Vector3 nativeTarget,
            Vector3 nativeUp,
            Vector3 nativeDirection,
            Quaternion nativeRotation,
            Matrix4x4 localToWorld)
        {
            return new CameraReceipt
            {
                cameraId = _cameraProfile.ProfileId,
                sourcePoseIndex = _cameraProfile.SourcePoseIndex,
                sourcePoseTimestamp = _cameraProfile.SourcePoseTimestamp,
                sourceFrame = _cameraProfile.Frames.Source.Id,
                nativeFrame = _cameraProfile.Frames.Native.Id,
                targetDerivation = _cameraProfile.TargetDerivation,
                targetCalibrationStatus = "inspection_only_not_calibrated_source_orientation",
                sourcePosition = _cameraProfile.Frames.Source.Position,
                sourceTarget = _cameraProfile.Frames.Source.Target,
                sourceUp = _cameraProfile.Frames.Source.Up,
                nativePosition = ToArray(nativePosition),
                nativeTarget = ToArray(nativeTarget),
                nativeUp = ToArray(nativeUp),
                nativeDirection = ToArray(nativeDirection),
                nativeQuaternionXyzw = ToArray(nativeRotation),
                expectedRawNativePosition = _cameraProfile.Frames.Native.ExpectedPosition,
                expectedRawNativeTarget = _cameraProfile.Frames.Native.ExpectedTarget,
                expectedRawNativeUp = _cameraProfile.Frames.Native.ExpectedUp,
                expectedRawNativeDirection = _cameraProfile.Frames.Native.ExpectedDirection,
                expectedRawNativeQuaternionXyzw = _cameraProfile.Frames.Native.ExpectedQuaternionXyzw,
                rawNativeAssertionTolerance = _cameraProfile.Frames.Native.AssertionTolerance,
                lccLocalToWorldMatrixColumnMajor = MatrixToColumnMajor(localToWorld),
                projection = _cameraProfile.Projection.Type,
                verticalFieldOfViewDegrees = (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees,
                nearClipMetres = (float)_cameraProfile.Projection.NearClipMetres,
                farClipMetres = (float)_cameraProfile.Projection.FarClipMetres,
                aspect = (float)_cameraProfile.Projection.Aspect
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
                            new Vector2(_cameraProfile.Output.Width, _cameraProfile.Output.Height),
                            (float)_cameraProfile.Projection.VerticalFieldOfViewDegrees);
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

            if (state.EnvironmentExclusionRequested)
            {
                AttemptRestore(
                    "environment exclusion request",
                    delegate
                    {
                        _lccSceneManager.SetEnvironmentData(false);
                        state.EnvironmentExclusionRequested = false;
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
            internal bool EnvironmentExclusionRequested;
            internal bool RenderAll;
            internal bool HasEnvironment;
            internal CameraReceipt Receipt;
        }
    }
}
