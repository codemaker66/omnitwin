using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using Cysharp.Threading.Tasks;
using LCCCore;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using XGrids.LCCWorld.Framework;
using XGrids.LCCWorld.Framework.Model;
using Debug = UnityEngine.Debug;

namespace Venviewer.NativeCapture
{
    public sealed class NativeCaptureModule : IModule
    {
        private const string ModuleId = "com.venviewer.native_capture";
        private const string ModuleVersion = "1.2.7";
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
                @"LCCEditor_Data\Managed\UnityEngine.ImageConversionModule.dll",
                "B9B639B4A278C2A01A7F326575D8D3C07280314682DA4DDDC055266E8A30953C"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\UnityEngine.UIModule.dll",
                "F6B73BB8B4DFF00448F0C2E20BF9A92487128A05F81AAF814A1DE021DA59C6A5"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\Unity.RenderPipelines.Core.Runtime.dll",
                "E68FCEB04E8F571E6F2B10ED15D5FE19A83E274EC557E68AE2D72C3E068E074D"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\Unity.RenderPipelines.Universal.Runtime.dll",
                "59458EF5AD12F800842598647AE8AE6E82A074852C1D2684B81A322FDBC86CE1"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\Unity.RenderPipelines.GPUDriven.Runtime.dll",
                "5A240D9060CA4ED75FBBF6D764C777477B5F6D11B8AC0B58D00E4F730C61661C"),
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
                "6AE62E082DC494A2433984177F60CA4DB5FAE69B1F360A8B33754172B310B8C5"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\mscorlib.dll",
                "E3CF08610C3F99B3436C106AB3C54564417B7EE47BC5D764311C4910B41EB1CE"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\System.dll",
                "0EA6AFCCBD47AC4110E0C3EA6A9ED3A2B5154445CBFAAD23531E2924AE80D40B"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\System.Core.dll",
                "FFD6840FA7808D2372FED8542FEA05B0913AC03018A3BF2BD3D200F078595C49"),
            new LockedRuntimeFile(
                @"LCCEditor_Data\Managed\System.Memory.dll",
                "C4F030A2CBA7DA7CDCF493257C24560E203D355904AEE490D645A935842F834A")
        };

        private IEventBus _eventBus;
        private IProjectManager _projectManager;
        private ICameraService _cameraService;
        private ISceneManager _sceneManager;
        private ILCCSceneManager _lccSceneManager;
        private ICaptureManager _captureManager;
        private IRendererQualityService _rendererQualityService;
        private Func<IEvent, bool> _modulesLoadedHandler;
        private Func<EventArg<bool>, bool> _sceneLoadBeginHandler;
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
        private bool _renderAllPendingDefaultDerivedFromFreshRenderer;
        private bool _renderAllPendingTrueRequestAttempted;
        private bool _renderAllPendingTrueRequestedBeforeLoad;
        private bool _renderAllActiveTrueObservedAfterLoad;
        private bool _renderAllPendingFalseResetAttempted;
        private bool _renderAllPendingFalseResetCallCompleted;
        private bool _modulesLoadedSubscribed;
        private bool _sceneLoadBeginSubscribed;
        private bool _subscribed;
        private PackageSnapshot _preLoadPackageSnapshot;
        private RuntimeClosureReceipt _preLoadRuntimeClosure;
        private bool _armed;
        private int _started;
        private int _sceneLoadedEventObserved;
        private int _sceneLoadBeginEventObserved;
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
        private SnapFrameReadbackOperation _activeReadbackOperation;

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
            _sceneLoadBeginHandler = HandleSceneLoadBegin;
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
                ConfigureUltraQualityBeforeSceneLoad();
                _sceneLoadBeginSubscribed = _eventBus.Subscribe(
                    "lccscene.load.begin",
                    _sceneLoadBeginHandler,
                    Int32.MaxValue);
                if (!_sceneLoadBeginSubscribed)
                {
                    throw new InvalidOperationException(
                        "The lccscene.load.begin subscription was rejected.");
                }
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
            AbortActiveReadbackOperation();
            UnsubscribeModulesLoaded();
            UnsubscribeSceneLoadBegin();
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

        private void UnsubscribeSceneLoadBegin()
        {
            if (!_sceneLoadBeginSubscribed || _eventBus == null || _sceneLoadBeginHandler == null)
            {
                return;
            }

            bool removed = _eventBus.Unsubscribe("lccscene.load.begin", _sceneLoadBeginHandler);
            _sceneLoadBeginSubscribed = false;
            if (!removed)
            {
                Debug.LogWarning(
                    "[VenviewerNativeCapture] lccscene.load.begin unsubscribe reported no matching handler.");
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

        private void AbortActiveReadbackOperation()
        {
            SnapFrameReadbackOperation operation = Volatile.Read(
                ref _activeReadbackOperation);
            if (operation != null)
            {
                operation.Abort();
            }
        }

        private void ValidateResolvedServices()
        {
            if (_eventBus == null || _cameraService == null || _sceneManager == null ||
                _lccSceneManager == null || _projectManager == null || _captureManager == null ||
                _rendererQualityService == null || _modulesLoadedHandler == null ||
                _sceneLoadBeginHandler == null || _sceneLoadedHandler == null)
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

        private void ConfigureUltraQualityBeforeSceneLoad()
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
                RestorePreLoadRenderState();
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

        private bool HandleSceneLoadBegin(EventArg<bool> eventData)
        {
            if (_lifecycle.IsStopped)
            {
                Debug.LogWarning("[VenviewerNativeCapture] lccscene.load.begin was ignored after Stop.");
                return true;
            }

            try
            {
                if (eventData == null)
                {
                    throw new InvalidOperationException(
                        "The lccscene.load.begin event supplied a null event argument.");
                }
                if (Interlocked.Exchange(ref _sceneLoadBeginEventObserved, 1) != 0)
                {
                    throw new InvalidOperationException(
                        "The lccscene.load.begin event was published more than once.");
                }

                bool activeRenderAllBeforeLoad = _lccSceneManager.IsRenderAll();
                if (activeRenderAllBeforeLoad)
                {
                    throw new InvalidOperationException(
                        "The fresh renderer unexpectedly reported an active loaded-dataset render-all state before load.");
                }
                _renderAllPendingDefaultDerivedFromFreshRenderer = _freshProjectStateVerified;
                _renderAllPendingTrueRequestAttempted = true;
                _lccSceneManager.SetRenderAll(true);
                _renderAllPendingTrueRequestedBeforeLoad = true;
            }
            catch (Exception exception)
            {
                FailArmedStartup(exception);
            }
            return true;
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
                _renderAllActiveTrueObservedAfterLoad = _lccSceneManager.IsRenderAll();
                if (Volatile.Read(ref _sceneLoadBeginEventObserved) == 0 ||
                    !_renderAllPendingDefaultDerivedFromFreshRenderer ||
                    !_renderAllPendingTrueRequestedBeforeLoad ||
                    !_renderAllActiveTrueObservedAfterLoad)
                {
                    throw new InvalidOperationException(
                        "Full-render mode was not requested before and observed after canonical scene load.");
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

            UnsubscribeSceneLoadBegin();
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

            UnsubscribeSceneLoadBegin();
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

            try
            {
                RestorePreLoadRenderState();
            }
            catch (Exception restoreException)
            {
                exitCode = 2;
                SetFailure(receipt, restoreException, "Pre-load render-state cleanup failed: ");
                Debug.LogException(restoreException);
            }

            receipt.sceneLoad = CreateSceneLoadReceipt();
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
                schemaVersion = "venviewer.grand-hall.lcc-native-capture-receipt.v7",
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
                    "Three consecutive byte-identical, decoded, non-degenerate PNGs establish a same-host pixel plateau only after the conservative readiness gate; they do not prove every possible streamed Gaussian is resident.",
                    "SetRenderAll(true) is applied in the synchronous lccscene.load.begin handler after renderer initialization and before the canonical Renderer.Load call, then observed again after lccscene.loaded. The public API still exposes no loaded-splat residency count or streaming-completion metric, so readiness also requires a minimum 300 rendered frames and 15 seconds before hash sampling.",
                    "The locked vendor SetRenderAll method writes a pending next-load field while IsRenderAll reads the active loaded-dataset field. Cleanup requests pending false without claiming a public read-back; disposable process exit is the final isolation boundary.",
                    "The first-party SnapFrame operation has cooperative cancellation at each end-of-frame await and restores the exact camera in its async finally block. It still cannot preempt a blocked Unity main thread, GPU synchronization, or native driver call; the external operator process watchdog and disposable process exit remain the hard boundary.",
                    "Admission pixels come only from a first-party RGB24 readback of the stable vendor-owned LCCCore.SnapFrameCaptureFeature.FrameRT. The module never calls SetActive, never changes TargetCamera, never destroys FrameRT, and never admits the previously rejected Camera.targetTexture or an ICaptureManager-returned Texture2D.",
                    "Before the first attempt, a synchronous public-getter-only URP inventory records every configured renderer-data feature, every already-instantiated renderer slot, and whether any configured SnapFrame feature matches SnapFrameCaptureFeature.Instance. It never calls renderer getters that can rebuild state, never creates a missing renderer, and scopes stability claims to that synchronous inventory window.",
                    "The public side-effect-free URP surface does not expose the scene camera's serialized renderer index. A sole non-null renderer-data/renderer pair is labelled an inference rather than an observed camera binding; ScriptableRendererFeature.isActive is only the base feature toggle and does not prove AddRenderPasses ran for this camera.",
                    "Each attempt requires exact-camera begin/end SRP callback history and a four-end-of-frame false/true/true/false FrameDirty handshake. A discarded five-centimetre transform sentinel and exact restore force a fresh public SnapFrame blit without changing source files or retaining a camera edit.",
                    "SnapFrame event 500 is CameraTarget after transparents and before later post-processing or overlay composition; it is not claimed to be the final visible framebuffer. The module rejects known capture overlays, visible capture view, camera/world-space Canvas contributors, camera stacks, target textures, and uncontrolled view helpers, while visual QA remains necessary.",
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
                canonicalSceneLoadedVerified = _canonicalSceneLoadedVerified,
                renderAllBeginEventTopic = "lccscene.load.begin",
                renderAllBeginEventSubscriptionAccepted =
                    _sceneLoadBeginSubscribed || Volatile.Read(ref _sceneLoadBeginEventObserved) != 0,
                renderAllBeginEventObserved = Volatile.Read(ref _sceneLoadBeginEventObserved) != 0,
                renderAllPendingDefaultDerivedFromFreshRenderer =
                    _renderAllPendingDefaultDerivedFromFreshRenderer,
                renderAllPendingTrueRequestedBeforeLoad = _renderAllPendingTrueRequestedBeforeLoad,
                renderAllActiveTrueObservedAfterLoad = _renderAllActiveTrueObservedAfterLoad,
                renderAllPendingFalseResetAttempted = _renderAllPendingFalseResetAttempted,
                renderAllPendingFalseResetCallCompleted = _renderAllPendingFalseResetCallCompleted,
                renderAllPendingResetReadbackAvailable = false,
                renderAllIsolationBoundary = "disposable_process_exit"
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
            float appliedRotationDot = Quaternion.Dot(rotation, expectedRotation);
            if (!IsFinite(appliedRotationDot) || Math.Abs(appliedRotationDot) < 0.999999)
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
            // The locked SupportFullRender implementation is a scene-budget predicate.
            // Full-render mode was requested before the scene load and remains a required read-back.
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
            Camera currentSceneCamera = _sceneManager.SceneCamera;
            if (state == null || state.Camera == null || currentSceneCamera == null ||
                state.Camera.GetInstanceID() != currentSceneCamera.GetInstanceID())
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
            float liveRotationDot = Quaternion.Dot(
                state.Camera.transform.rotation,
                ToUnityQuaternion(expectedQuaternion));
            if (!IsFinite(liveRotationDot) || Math.Abs(liveRotationDot) < 0.999999)
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
                !IsFinite(rect.x) || !IsFinite(rect.y) ||
                !IsFinite(rect.width) || !IsFinite(rect.height) ||
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
            if (!IsFinite(actual) || !IsFinite(expected) ||
                Math.Abs(actual - expected) > CapturePolicy.ProjectionTolerance)
            {
                throw new InvalidOperationException(
                    "The live scene-camera " + label + " drifted. Expected " +
                    expected.ToString("R", CultureInfo.InvariantCulture) + " but found " +
                    actual.ToString("R", CultureInfo.InvariantCulture) + ".");
            }
        }

        private static bool IsFinite(float value)
        {
            return !Single.IsNaN(value) && !Single.IsInfinity(value);
        }

        private async UniTask CaptureUntilConverged(CaptureReceipt capture, CameraState state)
        {
            ThrowIfStopped();
            capture.urpRendererInventory =
                SnapFrameReadbackOperation.CaptureReadOnlyUrpRendererInventory(
                    state.Camera);
            CapturePolicy.RequireReadOnlyUrpRendererInventory(
                capture.urpRendererInventory);
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
                var attempt = new CaptureAttemptReceipt
                {
                    ordinal = ordinal,
                    status = "running",
                    width = _cameraProfile.Output.Width,
                    height = _cameraProfile.Output.Height,
                    firstSrpEndCameraRenderingFrame = -1,
                    lastSrpEndCameraRenderingFrame = -1,
                    underlyingCaptureCancellationAvailable = true,
                    snapFrameSurface = new SnapFrameSurfaceReceipt()
                };
                capture.attempts.Add(attempt);
                try
                {
                    if (File.Exists(candidatePath))
                    {
                        throw new IOException("A capture candidate path already exists: " + candidatePath);
                    }

                    RequireLockedCameraState(state);
                    ThrowIfStopped();
                    await PopulateCaptureAttemptAsync(state, candidatePath, attempt);
                    ThrowIfStopped();

                    consecutive = String.Equals(previousHash, attempt.sha256, StringComparison.OrdinalIgnoreCase)
                        ? consecutive + 1
                        : 1;
                    previousHash = attempt.sha256;
                    attempt.consecutiveIdenticalHashes = consecutive;
                    attempt.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                    attempt.status = "accepted";
                }
                catch (Exception exception)
                {
                    attempt.status = "rejected";
                    attempt.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                    attempt.failureType = exception.GetType().FullName;
                    attempt.failureMessage = exception.Message;
                    capture.completedAttempts = capture.attempts.Count(
                        candidate => String.Equals(candidate.status, "accepted", StringComparison.Ordinal));
                    capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                    capture.everyAttemptDecodedAndNonDegenerate = false;
                    UpdateCaptureReadbackAggregates(capture);
                    throw;
                }

                capture.completedAttempts = capture.attempts.Count(
                    candidate => String.Equals(candidate.status, "accepted", StringComparison.Ordinal));
                capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
                capture.stableConsecutiveIdenticalHashes = consecutive;
                capture.everyAttemptDecodedAndNonDegenerate = capture.attempts.All(
                    candidate => String.Equals(candidate.status, "accepted", StringComparison.Ordinal) &&
                        candidate.raster != null && candidate.raster.nonDegenerateVerified);
                UpdateCaptureReadbackAggregates(capture);
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

        private async UniTask PopulateCaptureAttemptAsync(
            CameraState state,
            string candidatePath,
            CaptureAttemptReceipt attempt)
        {
            if (state == null || state.Camera == null)
            {
                throw new ArgumentNullException("state");
            }
            Texture2D texture = null;
            byte[] pngBytes;
            try
            {
                texture = await CaptureTextureWithTimeout(state, attempt);
                ThrowIfStopped();
                if (texture == null)
                {
                    throw new InvalidDataException(
                        "The first-party SnapFrame readback returned a null texture.");
                }
                if (texture.width != _cameraProfile.Output.Width ||
                    texture.height != _cameraProfile.Output.Height)
                {
                    throw new InvalidDataException(
                        "The first-party SnapFrame readback returned unexpected dimensions.");
                }

                if (!String.Equals(
                    attempt.firstPartyTextureFormat,
                    texture.format.ToString(),
                    StringComparison.Ordinal) ||
                    attempt.firstPartyTextureInstanceId != texture.GetInstanceID())
                {
                    throw new InvalidDataException(
                        "The transferred first-party SnapFrame texture differs from the readback receipt.");
                }
                attempt.firstPartyTextureReadable = texture.isReadable;
                attempt.firstPartyTextureNoMipChain = texture.mipmapCount == 1;
                if (!attempt.firstPartyTextureReadable || !attempt.firstPartyTextureNoMipChain)
                {
                    throw new InvalidDataException(
                        "The first-party SnapFrame texture is not readable RGB24 without mip levels.");
                }

                Color32[] pixels = texture.GetPixels32();
                attempt.pixelReadCompleted = true;
                byte[] rgb24 = ToRgb24(pixels);
                attempt.raster = CapturePolicy.AnalyzeRgb24(
                    rgb24,
                    _cameraProfile.Output.Width,
                    _cameraProfile.Output.Height);
                CapturePolicy.RequireNonDegenerateRaster(
                    attempt.raster,
                    _cameraProfile.Output.Width,
                    _cameraProfile.Output.Height);
                CapturePolicy.RequireSnapFrameExactRasterBinding(
                    attempt.snapFrameSurface,
                    attempt.raster);

                // Raster admission deliberately precedes encoding and publication.
                pngBytes = ImageConversion.EncodeToPNG(texture);
                if (pngBytes == null || pngBytes.Length == 0)
                {
                    throw new InvalidDataException("Unity ImageConversion returned an empty PNG payload.");
                }
                attempt.pngEncodingCompleted = true;
                attempt.encodedByteLength = pngBytes.LongLength;
                attempt.encodedSha256 = CapturePolicy.Sha256Bytes(pngBytes);
            }
            finally
            {
                if (texture != null)
                {
                    UnityEngine.Object.Destroy(texture);
                }
            }

            ThrowIfStopped();
            WriteNoReplaceBytes(candidatePath, pngBytes);
            CapturePolicy.RequirePngDimensions(
                candidatePath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            var info = new FileInfo(candidatePath);
            string fileSha256 = CapturePolicy.Sha256File(candidatePath);
            if (!String.Equals(fileSha256, attempt.encodedSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "The durably published PNG differs from the encoded in-memory payload.");
            }

            attempt.sha256 = fileSha256;
            attempt.byteLength = info.Length;
            attempt.postWriteFileShaVerified = true;
        }

        private static void UpdateCaptureReadbackAggregates(CaptureReceipt capture)
        {
            if (capture == null)
            {
                throw new ArgumentNullException("capture");
            }

            capture.standardCameraRenderCallbackProofAvailable = capture.attempts.Any(
                candidate => candidate.standardCameraRenderCallbackProofAvailable);
            string[] observedPixelSources = capture.attempts
                .Where(candidate => !String.IsNullOrEmpty(candidate.pixelSource))
                .Select(candidate => candidate.pixelSource)
                .ToArray();
            capture.observedPixelSource = observedPixelSources.FirstOrDefault();
            capture.everyObservedPixelSourceMatchesConfigured =
                observedPixelSources.Length > 0 &&
                observedPixelSources.All(candidate => String.Equals(
                    candidate,
                    capture.configuredPixelSource,
                    StringComparison.Ordinal));
        }

        private async UniTask<Texture2D> CaptureTextureWithTimeout(
            CameraState state,
            CaptureAttemptReceipt attempt)
        {
            if (state == null || state.Camera == null)
            {
                throw new ArgumentNullException("state");
            }
            Camera camera = state.Camera;
            ThrowIfStopped();
            var operation = new SnapFrameReadbackOperation(this, state, attempt);
            CancellationTokenSource deadlineCancellation = null;
            Texture2D completedTexture = null;
            bool completedTextureReturned = false;
            try
            {
                if (Interlocked.CompareExchange(
                    ref _activeReadbackOperation,
                    operation,
                    null) != null)
                {
                    throw new InvalidOperationException(
                        "A second SnapFrame readback operation cannot overlap the active operation.");
                }
                ThrowIfStopped();
                deadlineCancellation = new CancellationTokenSource();
                UniTask deadlineOrStopTask = WaitForCaptureDeadlineOrStopAsync(
                    deadlineCancellation.Token);
                ThrowIfStopped();
                UniTask<Texture2D> captureTask = operation.CaptureAsync().Preserve();
                (bool captureWon, Texture2D racedTexture) =
                    await UniTask.WhenAny(captureTask, deadlineOrStopTask);
                completedTexture = racedTexture;
                if (!captureWon)
                {
                    operation.Abort();
                    Texture2D cancelledTexture = null;
                    Exception cleanupFailure = null;
                    try
                    {
                        cancelledTexture = await captureTask;
                    }
                    catch (OperationCanceledException)
                    {
                    }
                    catch (Exception exception)
                    {
                        cleanupFailure = exception;
                    }
                    finally
                    {
                        if (cancelledTexture != null)
                        {
                            UnityEngine.Object.Destroy(cancelledTexture);
                        }
                    }
                    if (cleanupFailure != null)
                    {
                        throw new InvalidOperationException(
                            "The cancelled SnapFrame operation failed while restoring exact camera state.",
                            cleanupFailure);
                    }
                    if (_lifecycle.IsStopped)
                    {
                        attempt.captureTaskStopObserved = true;
                        throw new OperationCanceledException(
                            "Stop cancelled the first-party SnapFrame operation after exact camera restoration.");
                    }
                    attempt.captureTaskTimeoutObserved = true;
                    throw new TimeoutException(
                        "The first-party SnapFrame operation exceeded the cooperative Unity-player-loop deadline of " +
                        CapturePolicy.PerCaptureTimeoutSeconds.ToString("R", CultureInfo.InvariantCulture) +
                        " seconds and was cancelled after exact camera restoration. A blocked Unity main thread or GPU synchronization remains bounded only by disposable process exit.");
                }

                attempt.captureTaskCompletedBeforeDeadline = true;
                ThrowIfStopped();
                if (completedTexture == null)
                {
                    throw new InvalidDataException("The SnapFrame operation returned a null first-party texture.");
                }
                completedTextureReturned = true;
                return completedTexture;
            }
            finally
            {
                if (!completedTextureReturned && completedTexture != null)
                {
                    UnityEngine.Object.Destroy(completedTexture);
                }
                if (deadlineCancellation != null)
                {
                    deadlineCancellation.Cancel();
                    deadlineCancellation.Dispose();
                }
                operation.Abort();
                Interlocked.CompareExchange(
                    ref _activeReadbackOperation,
                    null,
                    operation);
                operation.Dispose();
            }
        }

        private async UniTask WaitForCaptureDeadlineOrStopAsync(
            CancellationToken cancellationToken)
        {
            await UniTask.WhenAny(
                UniTask.Delay(
                    TimeSpan.FromSeconds(CapturePolicy.PerCaptureTimeoutSeconds),
                    true,
                    PlayerLoopTiming.Update,
                    cancellationToken,
                    false).SuppressCancellationThrow(),
                UniTask.WaitUntil(
                    delegate { return _lifecycle.IsStopped; },
                    PlayerLoopTiming.Update,
                    cancellationToken,
                    false).SuppressCancellationThrow());
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

            CapturePolicy.RequirePngDimensions(
                capture.selectedAttemptPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            byte[] selectedBytes = File.ReadAllBytes(capture.selectedAttemptPath);
            string selectedBytesSha256 = CapturePolicy.Sha256Bytes(selectedBytes);
            CaptureAttemptReceipt selected = capture.attempts[capture.attempts.Count - 1];
            if (!String.Equals(selectedBytesSha256, selected.sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The selected candidate changed before finalization.");
            }

            WriteNoReplaceBytes(finalPath, selectedBytes);
            CapturePolicy.RequirePngDimensions(
                finalPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);

            var info = new FileInfo(finalPath);
            string sha256 = CapturePolicy.Sha256File(finalPath);
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
            RenderPipelineAsset pipelineAsset = GraphicsSettings.currentRenderPipeline;
            return new CaptureReceipt
            {
                surface = "ISceneManager.SceneCamera through public LCCCore.SnapFrameCaptureFeature.FrameRT at AfterRenderingTransparents, exact-camera SRP callback handshake, first-party RGB24 ReadPixels, and Unity ImageConversion.EncodeToPNG",
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
                perCaptureTimeoutSemantics = "cooperative_cancelled_end_of_frame_handshake_with_exact_camera_finally_restore",
                perCaptureTimeoutCanPreemptBlockedUnityMainThread = false,
                lateResultObserverCompletionAwaitedBeforeProcessExit = false,
                hardTerminationBoundary = "external_operator_process_watchdog",
                renderQuality = _rendererQualityService.CurrentQuality.ToString(),
                ultraQualityVerified = _rendererQualityService.CurrentQuality == RenderQualityType.Ultra,
                // Preserve the vendor predicate as telemetry without treating it as API capability.
                vendorFullRenderBudgetPredicate = "SupportFullRender(Ultra)",
                vendorFullRenderBudgetEligible =
                    _rendererQualityService.SupportFullRender(RenderQualityType.Ultra),
                vendorFullRenderBudgetEligibilityUsedForAdmission = false,
                renderAllRequested = true,
                renderAllObservedAfterRequest = _renderAllActiveTrueObservedAfterLoad,
                renderAllRequestedBeforeSceneLoad = _renderAllPendingTrueRequestedBeforeLoad,
                renderAllObservedAfterSceneLoad = _renderAllActiveTrueObservedAfterLoad,
                renderAllVerifiedAtEveryGate = false,
                canonicalPackageHasEnvironment = _lccSceneManager.HasEnvironment,
                environmentDataIncluded = false,
                environmentExclusionRequested = true,
                environmentExclusionReason = _cameraProfile.Environment.Reason,
                environmentVisibilityGetterAvailable = _cameraProfile.Environment.VisibilityGetterAvailable,
                renderCallbackSurface = "RenderPipelineManager.beginCameraRendering and endCameraRendering for the exact SceneCamera at baseline, discarded sentinel, exact restore, and stable exact stages",
                globalCameraCallbackRequiredForAdmission = true,
                standardCameraRenderCallbackProofAvailable = false,
                pipelineAssetType = pipelineAsset == null
                    ? "null"
                    : pipelineAsset.GetType().AssemblyQualifiedName,
                configuredPixelSource = CapturePolicy.SnapFramePixelSource,
                observedPixelSource = null,
                everyObservedPixelSourceMatchesConfigured = false,
                blackChannelThreshold = CapturePolicy.BlackChannelThreshold,
                minimumNonBlackPixelFraction = CapturePolicy.MinimumNonBlackPixelFraction,
                minimumMaximumChannelDynamicRange = CapturePolicy.MinimumMaximumChannelDynamicRange,
                minimumDistinctRgbCount = CapturePolicy.MinimumDistinctRgbCount,
                minimumLuminanceStandardDeviation = CapturePolicy.MinimumLuminanceStandardDeviation,
                everyAttemptDecodedAndNonDegenerate = false,
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
            if (restoreErrors.Count > 0)
            {
                throw new AggregateException("One or more native capture cleanup operations failed.", restoreErrors);
            }
        }

        private void RestorePreLoadRenderState()
        {
            var restoreErrors = new List<Exception>();
            if (_renderAllPendingTrueRequestAttempted && _lccSceneManager != null &&
                !_renderAllPendingFalseResetAttempted)
            {
                AttemptRestore(
                    "fresh-renderer pending render-all default",
                    delegate
                    {
                        _renderAllPendingFalseResetAttempted = true;
                        _lccSceneManager.SetRenderAll(false);
                        _renderAllPendingFalseResetCallCompleted = true;
                    },
                    restoreErrors);
            }

            if (_qualityCaptured && _rendererQualityService != null)
            {
                AttemptRestore(
                    "renderer quality",
                    delegate
                    {
                        if (_rendererQualityService.CurrentQuality != _originalQuality)
                        {
                            _rendererQualityService.SetRenderQualityType(_originalQuality);
                        }
                        if (_rendererQualityService.CurrentQuality != _originalQuality)
                        {
                            throw new InvalidOperationException(
                                "The original renderer quality could not be restored.");
                        }
                        _qualityCaptured = false;
                    },
                    restoreErrors);
            }

            if (restoreErrors.Count > 0)
            {
                throw new AggregateException(
                    "One or more pre-load render-state cleanup operations failed.",
                    restoreErrors);
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

        private static void WriteNoReplaceBytes(string path, byte[] bytes)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException("bytes");
            }
            if (File.Exists(path))
            {
                throw new IOException("Refusing to replace an existing binary path: " + path);
            }

            string temporaryPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                using (var stream = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(path))
                {
                    throw new IOException("The binary destination appeared during publication: " + path);
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

        private static byte[] ToRgb24(Color32[] pixels)
        {
            if (pixels == null)
            {
                throw new ArgumentNullException("pixels");
            }

            var rgb24 = new byte[checked(pixels.Length * 3)];
            for (int pixelIndex = 0; pixelIndex < pixels.Length; pixelIndex += 1)
            {
                int byteOffset = pixelIndex * 3;
                Color32 pixel = pixels[pixelIndex];
                rgb24[byteOffset] = pixel.r;
                rgb24[byteOffset + 1] = pixel.g;
                rgb24[byteOffset + 2] = pixel.b;
            }
            return rgb24;
        }

        private static void HandleUnhandledException(Exception exception)
        {
            Debug.LogException(exception);
            Application.Quit(2);
        }

        private sealed class SnapFrameReadbackOperation : IDisposable
        {
            private const int MaximumRecordedCameraCallbacks = 64;
            private const string BaselineStage = "baseline_exact";
            private const string SentinelStage = "sentinel_discard";
            private const string RestoredStage = "restored_exact";
            private const string StableStage = "stable_exact";

            private readonly NativeCaptureModule _owner;
            private readonly CameraState _cameraState;
            private readonly Camera _camera;
            private readonly int _cameraInstanceId;
            private readonly CaptureAttemptReceipt _attempt;
            private readonly SnapFrameSurfaceReceipt _surface;
            private readonly CancellationTokenSource _cancellation = new CancellationTokenSource();
            private readonly Action<ScriptableRenderContext, Camera> _beginHandler;
            private readonly Action<ScriptableRenderContext, Camera> _endHandler;
            private readonly Vector3 _exactPosition;
            private readonly Quaternion _exactRotation;
            private readonly Matrix4x4 _exactWorldToCamera;
            private readonly Matrix4x4 _exactProjection;
            private readonly Vector3 _sentinelPosition;
            private SnapFrameCaptureFeature _feature;
            private int _featureInstanceId;
            private int _frameRenderTextureInstanceId;
            private string _stage;
            private Vector3 _stageExpectedPosition;
            private Quaternion _stageExpectedRotation;
            private Matrix4x4 _stageExpectedWorldToCamera;
            private int _callbackSequence;
            private bool _subscribed;
            private int _abortRequested;
            private int _disposed;

            internal SnapFrameReadbackOperation(
                NativeCaptureModule owner,
                CameraState cameraState,
                CaptureAttemptReceipt attempt)
            {
                if (owner == null)
                {
                    throw new ArgumentNullException("owner");
                }
                if (cameraState == null || cameraState.Camera == null)
                {
                    throw new ArgumentNullException("cameraState");
                }
                if (attempt == null)
                {
                    throw new ArgumentNullException("attempt");
                }

                _owner = owner;
                _cameraState = cameraState;
                _camera = cameraState.Camera;
                _cameraInstanceId = _camera.GetInstanceID();
                _attempt = attempt;
                _surface = attempt.snapFrameSurface ?? new SnapFrameSurfaceReceipt();
                _attempt.snapFrameSurface = _surface;
                _surface.cameraCallbacks = new List<SnapFrameCameraCallbackReceipt>();
                _surface.activeCanvases = new List<SnapFrameCanvasReceipt>();
                _surface.knownActiveCaptureOverlayNames = new string[0];
                _surface.everyCameraCallbackMatchedStagePose = true;
                _surface.cleanViewStateVerifiedAtEveryCheckpoint = true;
                _surface.frameSurfaceProvenance =
                    "vendor_snap_frame_camera_target_after_transparents_pre_postprocess";
                _exactPosition = _camera.transform.position;
                _exactRotation = _camera.transform.rotation;
                _exactWorldToCamera = _camera.worldToCameraMatrix;
                _exactProjection = _camera.projectionMatrix;
                _sentinelPosition = _exactPosition + new Vector3(
                    (float)CapturePolicy.SnapFrameSentinelTranslationMetres,
                    0.0f,
                    0.0f);
                _beginHandler = HandleBeginCameraRendering;
                _endHandler = HandleEndCameraRendering;
            }

            internal async UniTask<Texture2D> CaptureAsync()
            {
                Texture2D sentinelTexture = null;
                Texture2D exactTexture = null;
                bool exactOwnershipTransferred = false;
                Exception operationFailure = null;
                try
                {
                    ThrowIfAbortedOrStopped();
                    CaptureInitialSurfaceState();
                    Subscribe();

                    SetStage(
                        BaselineStage,
                        _exactPosition,
                        _exactRotation,
                        _exactWorldToCamera);
                    _owner._lccSceneManager.ForceRerenderer();
                    await UniTask.WaitForEndOfFrame(_cancellation.Token);
                    ThrowIfAbortedOrStopped();
                    SnapFrameCameraCallbackReceipt baseline = RequireStageEndCallback(
                        BaselineStage,
                        -1,
                        false);
                    _surface.baselineExactEndCallbackVerified = true;
                    _surface.dirtyBeforeRequest = ToDirtyObservation(baseline);
                    _surface.frameRenderTextureBefore = ObserveAndRequireFrameRenderTexture(
                        baseline.frame,
                        0);
                    RequireCheckpoint(
                        Checkpoint.Before,
                        _surface.frameRenderTextureBefore.instanceId);

                    ApplyPose(_sentinelPosition, _exactRotation);
                    _surface.sentinelPosition = ToArray(_sentinelPosition);
                    _surface.sentinelRotationXyzw = ToArray(_exactRotation);
                    _surface.sentinelWorldToCameraMatrixColumnMajor =
                        MatrixToColumnMajor(_camera.worldToCameraMatrix);
                    SetStage(
                        SentinelStage,
                        _sentinelPosition,
                        _exactRotation,
                        _camera.worldToCameraMatrix);
                    _owner._lccSceneManager.ForceRerenderer();
                    await UniTask.WaitForEndOfFrame(_cancellation.Token);
                    ThrowIfAbortedOrStopped();
                    _surface.sentinelPoseReached = PoseMatches(
                        _camera,
                        _sentinelPosition,
                        _exactRotation,
                        _camera.worldToCameraMatrix);
                    if (!_surface.sentinelPoseReached)
                    {
                        throw new InvalidOperationException(
                            "The deterministic transform sentinel was not reached by the exact scene camera.");
                    }
                    SnapFrameCameraCallbackReceipt sentinel = RequireStageEndCallback(
                        SentinelStage,
                        baseline.frame,
                        true);
                    _surface.sentinelEndCallbackVerified = true;
                    _surface.dirtyAfterRequest = ToDirtyObservation(sentinel);
                    _surface.frameRenderTextureAfterDirtyRequest = ObserveAndRequireFrameRenderTexture(
                        sentinel.frame,
                        _surface.frameRenderTextureBefore.instanceId);
                    RequireCheckpoint(
                        Checkpoint.AfterDirtyRequest,
                        _surface.frameRenderTextureAfterDirtyRequest.instanceId);
                    _surface.sentinelReadback = new SnapFrameReadbackReceipt();
                    sentinelTexture = ReadFrameRenderTexture(
                        _feature.FrameRT,
                        _surface.sentinelReadback);
                    byte[] sentinelRgb24 = ToRgb24(sentinelTexture.GetPixels32());
                    _surface.sentinelRaster = CapturePolicy.AnalyzeRgb24(
                        sentinelRgb24,
                        _owner._cameraProfile.Output.Width,
                        _owner._cameraProfile.Output.Height);
                    CapturePolicy.RequireNonDegenerateRaster(
                        _surface.sentinelRaster,
                        _owner._cameraProfile.Output.Width,
                        _owner._cameraProfile.Output.Height);
                    UnityEngine.Object.Destroy(sentinelTexture);
                    sentinelTexture = null;

                    RestoreExactCameraState();
                    SetStage(
                        RestoredStage,
                        _exactPosition,
                        _exactRotation,
                        _exactWorldToCamera);
                    _owner._lccSceneManager.ForceRerenderer();
                    await UniTask.WaitForEndOfFrame(_cancellation.Token);
                    ThrowIfAbortedOrStopped();
                    SnapFrameCameraCallbackReceipt restored = RequireStageEndCallback(
                        RestoredStage,
                        sentinel.frame,
                        true);
                    _surface.restoredExactEndCallbackVerified = true;
                    _surface.dirtyBeforeReadback = ToDirtyObservation(restored);
                    _surface.frameRenderTextureBeforeReadback = ObserveAndRequireFrameRenderTexture(
                        restored.frame,
                        _surface.frameRenderTextureAfterDirtyRequest.instanceId);
                    RequireCheckpoint(
                        Checkpoint.BeforeReadback,
                        _surface.frameRenderTextureBeforeReadback.instanceId);

                    SetStage(
                        StableStage,
                        _exactPosition,
                        _exactRotation,
                        _exactWorldToCamera);
                    _owner._lccSceneManager.ForceRerenderer();
                    await UniTask.WaitForEndOfFrame(_cancellation.Token);
                    ThrowIfAbortedOrStopped();
                    SnapFrameCameraCallbackReceipt stable = RequireStageEndCallback(
                        StableStage,
                        restored.frame,
                        false);
                    _surface.stableExactEndCallbackVerified = true;
                    _surface.dirtyAfterCompletion = ToDirtyObservation(stable);
                    _surface.frameRenderTextureAfter = ObserveAndRequireFrameRenderTexture(
                        stable.frame,
                        _surface.frameRenderTextureBeforeReadback.instanceId);
                    RequireCheckpoint(
                        Checkpoint.After,
                        _surface.frameRenderTextureAfter.instanceId);

                    _surface.featureTargetCameraLiveAtReadback = IsLiveCamera(_feature.TargetCamera);
                    _surface.featureTargetCameraInstanceIdAtReadback =
                        _surface.featureTargetCameraLiveAtReadback
                            ? _feature.TargetCamera.GetInstanceID()
                            : 0;
                    _surface.exactRestoreVerified = ExactCameraStateMatches();
                    if (!_surface.exactRestoreVerified)
                    {
                        throw new InvalidOperationException(
                            "The exact inspection camera state was not restored before SnapFrame readback.");
                    }
                    _owner.RequireLockedCameraState(_cameraState);

                    _surface.readback = new SnapFrameReadbackReceipt();
                    exactTexture = ReadFrameRenderTexture(_feature.FrameRT, _surface.readback);
                    byte[] exactRgb24 = ToRgb24(exactTexture.GetPixels32());
                    _surface.exactFrameRgb24Sha256 = CapturePolicy.Sha256Bytes(exactRgb24);
                    _surface.sentinelAndExactRgbDiffer = !String.Equals(
                        _surface.sentinelRaster.rgb24Sha256,
                        _surface.exactFrameRgb24Sha256,
                        StringComparison.OrdinalIgnoreCase);
                    if (!_surface.sentinelAndExactRgbDiffer)
                    {
                        throw new InvalidDataException(
                            "The sentinel and exact-pose SnapFrame rasters were byte-identical; fresh surface response is unproved.");
                    }

                    _attempt.firstPartyTextureInstanceId = exactTexture.GetInstanceID();
                    _attempt.firstPartyTextureFormat = exactTexture.format.ToString();
                    _attempt.firstPartyTextureReadable = exactTexture.isReadable;
                    _attempt.firstPartyTextureNoMipChain = exactTexture.mipmapCount == 1;
                    _attempt.firstPartyReadPixelsCompleted = _surface.readback.firstPartyReadPixelsCompleted;
                    _attempt.firstPartyApplyCompleted = _surface.readback.firstPartyApplyCompleted;
                    _attempt.pixelSource = CapturePolicy.SnapFramePixelSource;
                    _attempt.readbackTrigger = "public_snap_frame_four_eof_camera_callback_handshake";
                    _attempt.standardCameraRenderCallbackProofAvailable = true;
                    _attempt.srpEndCameraRenderingCallbackCount =
                        _surface.endCameraRenderingCallbackCount;
                    _attempt.firstSrpEndCameraRenderingFrame = baseline.frame;
                    _attempt.lastSrpEndCameraRenderingFrame = stable.frame;

                    CaptureExactCameraAfterState();
                    CaptureFinalSurfaceState();
                    Unsubscribe();
                    CapturePolicy.RequireSnapFrameCaptureRoute(
                        _surface,
                        _attempt.pixelSource);
                    exactOwnershipTransferred = true;
                    return exactTexture;
                }
                catch (Exception exception)
                {
                    operationFailure = exception;
                    throw;
                }
                finally
                {
                    Exception cleanupFailure = null;
                    try
                    {
                        if (!ExactCameraStateMatches())
                        {
                            RestoreExactCameraState();
                        }
                        CaptureExactCameraAfterState();
                        _owner.RequireLockedCameraState(_cameraState);
                    }
                    catch (Exception exception)
                    {
                        cleanupFailure = exception;
                    }
                    try
                    {
                        CaptureFinalSurfaceState();
                    }
                    catch (Exception exception)
                    {
                        if (cleanupFailure == null)
                        {
                            cleanupFailure = exception;
                        }
                        else
                        {
                            cleanupFailure = new AggregateException(
                                cleanupFailure,
                                exception);
                        }
                    }
                    Unsubscribe();
                    if (sentinelTexture != null)
                    {
                        UnityEngine.Object.Destroy(sentinelTexture);
                    }
                    if ((!exactOwnershipTransferred || cleanupFailure != null) &&
                        exactTexture != null)
                    {
                        UnityEngine.Object.Destroy(exactTexture);
                    }
                    if (cleanupFailure != null)
                    {
                        Exception combinedFailure = operationFailure == null
                            ? cleanupFailure
                            : new AggregateException(operationFailure, cleanupFailure);
                        throw new InvalidOperationException(
                            "SnapFrame cleanup could not prove exact camera and surface restoration.",
                            combinedFailure);
                    }
                }
            }

            internal void Abort()
            {
                if (Interlocked.Exchange(ref _abortRequested, 1) != 0)
                {
                    return;
                }
                try
                {
                    _cancellation.Cancel();
                }
                catch (ObjectDisposedException)
                {
                }
            }

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) != 0)
                {
                    return;
                }
                Abort();
                _cancellation.Dispose();
            }

            private void CaptureInitialSurfaceState()
            {
                _owner.RequireLockedCameraState(_cameraState);
                _feature = SnapFrameCaptureFeature.Instance;
                _surface.featurePresent = _feature != null;
                if (!_surface.featurePresent)
                {
                    throw new InvalidOperationException(
                        "The locked URP asset did not expose LCCCore.SnapFrameCaptureFeature.Instance.");
                }
                _featureInstanceId = _feature.GetInstanceID();
                _surface.featureTypeFullName = _feature.GetType().FullName;
                _surface.featureInstanceId = _featureInstanceId;
                _surface.featureStaticInstanceMatched =
                    SnapFrameCaptureFeature.Instance != null &&
                    SnapFrameCaptureFeature.Instance.GetInstanceID() == _featureInstanceId;
                _surface.featureBaseActiveBefore = _feature.isActive;
                _surface.sceneCameraLive = IsLiveCamera(_owner._sceneManager.SceneCamera);
                _surface.sceneCameraInstanceId = _surface.sceneCameraLive
                    ? _owner._sceneManager.SceneCamera.GetInstanceID()
                    : 0;
                _surface.featureTargetCameraLiveBefore = IsLiveCamera(_feature.TargetCamera);
                _surface.featureTargetCameraInstanceIdBefore =
                    _surface.featureTargetCameraLiveBefore
                        ? _feature.TargetCamera.GetInstanceID()
                        : 0;
                if (!_surface.featureStaticInstanceMatched || !_surface.featureBaseActiveBefore ||
                    !_surface.sceneCameraLive || !_surface.featureTargetCameraLiveBefore ||
                    _surface.sceneCameraInstanceId != _cameraInstanceId ||
                    _surface.featureTargetCameraInstanceIdBefore != _cameraInstanceId)
                {
                    throw new InvalidOperationException(
                        "The public SnapFrame feature is absent, inactive, or not bound to the exact scene camera.");
                }

                _surface.exactPositionBefore = ToArray(_exactPosition);
                _surface.exactRotationXyzwBefore = ToArray(_exactRotation);
                _surface.exactWorldToCameraMatrixColumnMajorBefore =
                    MatrixToColumnMajor(_exactWorldToCamera);
                _surface.exactProjectionMatrixColumnMajorBefore =
                    MatrixToColumnMajor(_exactProjection);
                _surface.graphicsDeviceType = SystemInfo.graphicsDeviceType.ToString();
                _surface.graphicsUvStartsAtTop = SystemInfo.graphicsUVStartsAtTop;
                _surface.activeColorSpace = QualitySettings.activeColorSpace.ToString();
                _surface.readPixelsCoordinateOrigin =
                    CapturePolicy.SnapFrameReadPixelsCoordinateOrigin;
                _surface.cpuRowTransform = CapturePolicy.SnapFrameCpuRowTransform;
                CaptureCameraConfiguration();
                CaptureOverlayInventory();
                _surface.sceneCameraTargetTextureNullBefore = _camera.targetTexture == null;
                _surface.captureViewAbsentBefore = !_owner._captureManager.IsCaptureViewVisible;
                RequireNoUnsafeSurfaceContributor();
            }

            internal static UrpRendererInventoryReceipt CaptureReadOnlyUrpRendererInventory(
                Camera camera)
            {
                if (camera == null)
                {
                    throw new ArgumentNullException("camera");
                }
                const string ObservationApi =
                    "GraphicsSettings.currentRenderPipeline + UniversalRenderPipelineAsset.rendererDataList/renderers + ScriptableRendererData.rendererFeatures";
                var receipt = new UrpRendererInventoryReceipt
                {
                    observationApi = ObservationApi,
                    observationFrame = Time.frameCount,
                    observationRealtimeSeconds = Time.realtimeSinceStartupAsDouble,
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
                    rendererData = new List<UrpRendererDataReceipt>(),
                    rendererInstances = new List<UrpRendererInstanceReceipt>(),
                    sceneCameraRendererIndex = -1,
                    sceneCameraRendererIndexProvenance =
                        "unavailable_without_a_public_side_effect_free_renderer_index_getter"
                };

                RenderPipelineAsset pipelineAsset = GraphicsSettings.currentRenderPipeline;
                receipt.currentRenderPipelineAssetPresent = pipelineAsset != null;
                receipt.currentRenderPipelineAssetName = pipelineAsset == null
                    ? null
                    : pipelineAsset.name;
                receipt.currentRenderPipelineAssetTypeFullName = pipelineAsset == null
                    ? null
                    : pipelineAsset.GetType().FullName;
                receipt.currentRenderPipelineAssetInstanceId = pipelineAsset == null
                    ? 0
                    : pipelineAsset.GetInstanceID();
                UniversalRenderPipelineAsset universalAsset =
                    pipelineAsset as UniversalRenderPipelineAsset;
                receipt.currentRenderPipelineAssetIsUniversal = universalAsset != null;
                receipt.universalAdditionalCameraDataPresent =
                    camera.GetComponent<UniversalAdditionalCameraData>() != null;
                if (universalAsset == null)
                {
                    return receipt;
                }

                SnapFrameCaptureFeature staticSnapFrameFeature =
                    SnapFrameCaptureFeature.Instance;
                receipt.snapFrameStaticInstancePresent =
                    staticSnapFrameFeature != null;
                receipt.snapFrameStaticInstanceId = staticSnapFrameFeature == null
                    ? 0
                    : staticSnapFrameFeature.GetInstanceID();
                receipt.snapFrameStaticInstanceTypeFullName =
                    staticSnapFrameFeature == null
                        ? null
                        : staticSnapFrameFeature.GetType().FullName;

                ReadOnlySpan<ScriptableRendererData> rendererDataSpan =
                    universalAsset.rendererDataList;
                ReadOnlySpan<ScriptableRenderer> rendererSpan = universalAsset.renderers;
                receipt.rendererDataCount = rendererDataSpan.Length;
                receipt.rendererInstanceCount = rendererSpan.Length;
                receipt.rendererDataAndInstanceCountsMatch =
                    rendererDataSpan.Length == rendererSpan.Length;

                var rendererDataReferences =
                    new ScriptableRendererData[rendererDataSpan.Length];
                var rendererReferences = new ScriptableRenderer[rendererSpan.Length];
                var featureReferences =
                    new List<ScriptableRendererFeature[]>(rendererDataSpan.Length);
                var featureActiveStates = new List<bool[]>(rendererDataSpan.Length);

                for (int index = 0; index < rendererDataSpan.Length; index += 1)
                {
                    ScriptableRendererData rendererData = rendererDataSpan[index];
                    rendererDataReferences[index] = rendererData;
                    var dataReceipt = new UrpRendererDataReceipt
                    {
                        rendererDataIndex = index,
                        present = rendererData != null,
                        name = rendererData == null ? null : rendererData.name,
                        typeFullName = rendererData == null
                            ? null
                            : rendererData.GetType().FullName,
                        instanceId = rendererData == null ? 0 : rendererData.GetInstanceID(),
                        useNativeRenderPass = rendererData != null &&
                            rendererData.useNativeRenderPass,
                        features = new List<UrpRendererFeatureReceipt>()
                    };
                    List<ScriptableRendererFeature> features = rendererData == null
                        ? null
                        : rendererData.rendererFeatures;
                    int featureCount = features == null ? 0 : features.Count;
                    dataReceipt.featureCount = featureCount;
                    var entryFeatureReferences =
                        new ScriptableRendererFeature[featureCount];
                    var entryFeatureActiveStates = new bool[featureCount];
                    for (int featureIndex = 0;
                        featureIndex < featureCount;
                        featureIndex += 1)
                    {
                        ScriptableRendererFeature feature = features[featureIndex];
                        entryFeatureReferences[featureIndex] = feature;
                        bool present = feature != null;
                        bool active = present && feature.isActive;
                        entryFeatureActiveStates[featureIndex] = active;
                        string typeFullName = present ? feature.GetType().FullName : null;
                        bool isSnapFrame = String.Equals(
                            typeFullName,
                            CapturePolicy.SnapFrameFeatureTypeFullName,
                            StringComparison.Ordinal);
                        bool matchesStaticInstance = present &&
                            staticSnapFrameFeature != null &&
                            feature.GetInstanceID() ==
                                staticSnapFrameFeature.GetInstanceID();
                        if (isSnapFrame)
                        {
                            dataReceipt.snapFrameCaptureFeatureCount += 1;
                            receipt.snapFrameCaptureFeatureCount += 1;
                            if (active)
                            {
                                receipt.activeSnapFrameCaptureFeatureCount += 1;
                            }
                            if (matchesStaticInstance)
                            {
                                receipt.snapFrameStaticInstanceMatchedConfiguredFeatureCount += 1;
                            }
                        }
                        dataReceipt.features.Add(new UrpRendererFeatureReceipt
                        {
                            featureIndex = featureIndex,
                            present = present,
                            name = present ? feature.name : null,
                            typeFullName = typeFullName,
                            instanceId = present ? feature.GetInstanceID() : 0,
                            active = active,
                            snapFrameCaptureFeatureType = isSnapFrame,
                            matchesSnapFrameStaticInstance = matchesStaticInstance
                        });
                    }
                    featureReferences.Add(entryFeatureReferences);
                    featureActiveStates.Add(entryFeatureActiveStates);
                    receipt.rendererData.Add(dataReceipt);
                }

                for (int index = 0; index < rendererSpan.Length; index += 1)
                {
                    ScriptableRenderer renderer = rendererSpan[index];
                    rendererReferences[index] = renderer;
                    receipt.rendererInstances.Add(new UrpRendererInstanceReceipt
                    {
                        rendererIndex = index,
                        present = renderer != null,
                        typeFullName = renderer == null ? null : renderer.GetType().FullName,
                        runtimeIdentityHashCode = renderer == null
                            ? 0
                            : RuntimeHelpers.GetHashCode(renderer)
                    });
                }

                receipt.sceneCameraRendererIndexInferred =
                    rendererDataSpan.Length == 1 && rendererSpan.Length == 1 &&
                    rendererDataReferences[0] != null &&
                    rendererReferences[0] != null;
                if (receipt.sceneCameraRendererIndexInferred)
                {
                    receipt.sceneCameraRendererIndex = 0;
                    receipt.sceneCameraRendererIndexProvenance =
                        "sole_renderer_data_and_instance_entry";
                }

                ReadOnlySpan<ScriptableRendererData> rendererDataAfter =
                    universalAsset.rendererDataList;
                ReadOnlySpan<ScriptableRenderer> renderersAfter = universalAsset.renderers;
                bool rendererIdentityStable =
                    rendererDataAfter.Length == rendererDataReferences.Length &&
                    renderersAfter.Length == rendererReferences.Length;
                if (rendererIdentityStable)
                {
                    for (int index = 0;
                        index < rendererDataReferences.Length;
                        index += 1)
                    {
                        rendererIdentityStable &= System.Object.ReferenceEquals(
                            rendererDataAfter[index],
                            rendererDataReferences[index]);
                    }
                    for (int index = 0;
                        index < rendererReferences.Length;
                        index += 1)
                    {
                        rendererIdentityStable &= System.Object.ReferenceEquals(
                            renderersAfter[index],
                            rendererReferences[index]);
                    }
                }
                receipt.rendererObjectIdentityStableDuringSynchronousInventory =
                    rendererIdentityStable;

                bool featureStateStable = rendererIdentityStable;
                if (featureStateStable)
                {
                    for (int dataIndex = 0;
                        dataIndex < rendererDataReferences.Length;
                        dataIndex += 1)
                    {
                        ScriptableRendererData rendererData = rendererDataReferences[dataIndex];
                        List<ScriptableRendererFeature> currentFeatures = rendererData == null
                            ? null
                            : rendererData.rendererFeatures;
                        ScriptableRendererFeature[] expectedFeatures =
                            featureReferences[dataIndex];
                        bool[] expectedActiveStates = featureActiveStates[dataIndex];
                        int currentFeatureCount = currentFeatures == null
                            ? 0
                            : currentFeatures.Count;
                        if (currentFeatureCount != expectedFeatures.Length)
                        {
                            featureStateStable = false;
                            break;
                        }
                        for (int featureIndex = 0;
                            featureIndex < expectedFeatures.Length;
                            featureIndex += 1)
                        {
                            ScriptableRendererFeature currentFeature =
                                currentFeatures[featureIndex];
                            bool currentActive =
                                currentFeature != null && currentFeature.isActive;
                            if (!System.Object.ReferenceEquals(
                                    currentFeature,
                                    expectedFeatures[featureIndex]) ||
                                currentActive != expectedActiveStates[featureIndex])
                            {
                                featureStateStable = false;
                                break;
                            }
                        }
                        if (!featureStateStable)
                        {
                            break;
                        }
                    }
                }
                receipt.rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory =
                    featureStateStable;
                SnapFrameCaptureFeature staticSnapFrameFeatureAfter =
                    SnapFrameCaptureFeature.Instance;
                bool staticInstanceStable = System.Object.ReferenceEquals(
                    staticSnapFrameFeature,
                    staticSnapFrameFeatureAfter);
                receipt.snapFrameStaticInstanceStableDuringSynchronousInventory =
                    staticInstanceStable;
                receipt.mutationObservedDuringSynchronousInventory =
                    !rendererIdentityStable || !featureStateStable ||
                    !staticInstanceStable;
                return receipt;
            }

            private void CaptureFinalSurfaceState()
            {
                SnapFrameCaptureFeature currentFeature = SnapFrameCaptureFeature.Instance;
                _surface.featureStaticInstanceMatched =
                    _surface.featureStaticInstanceMatched && currentFeature != null &&
                    currentFeature.GetInstanceID() == _featureInstanceId;
                _surface.featureBaseActiveAfter = currentFeature != null && currentFeature.isActive;
                Camera target = currentFeature == null ? null : currentFeature.TargetCamera;
                _surface.featureTargetCameraLiveAfter = IsLiveCamera(target);
                _surface.featureTargetCameraInstanceIdAfter =
                    _surface.featureTargetCameraLiveAfter ? target.GetInstanceID() : 0;
                _surface.featureTargetUnchanged =
                    _surface.featureTargetCameraInstanceIdBefore == _cameraInstanceId &&
                    _surface.featureTargetCameraInstanceIdAtReadback == _cameraInstanceId &&
                    _surface.featureTargetCameraInstanceIdAfter == _cameraInstanceId;
                _surface.sceneCameraTargetTextureNullAfter = _camera.targetTexture == null;
                _surface.captureViewAbsentAfter = !_owner._captureManager.IsCaptureViewVisible;
                _surface.sceneCameraCullingMaskAfter = _camera.cullingMask;
                _surface.sceneCameraTargetDisplayAfter = _camera.targetDisplay;
                _surface.sceneCameraRectAfter = RectToArray(_camera.rect);
                _surface.sceneCameraPixelRectAfter = RectToArray(_camera.pixelRect);
                _surface.cameraConfigurationUnchanged =
                    _surface.sceneCameraCullingMaskAfter == _surface.sceneCameraCullingMask &&
                    _surface.sceneCameraTargetDisplayAfter == _surface.sceneCameraTargetDisplay &&
                    RectArraysEqual(_surface.sceneCameraRectAfter, _surface.sceneCameraRect) &&
                    RectArraysEqual(_surface.sceneCameraPixelRectAfter, _surface.sceneCameraPixelRect) &&
                    _camera.pixelWidth == _surface.sceneCameraPixelWidth &&
                    _camera.pixelHeight == _surface.sceneCameraPixelHeight;
                CaptureOverlayInventory();
            }

            private void CaptureCameraConfiguration()
            {
                _surface.sceneCameraPixelWidth = _camera.pixelWidth;
                _surface.sceneCameraPixelHeight = _camera.pixelHeight;
                _surface.screenWidth = Screen.width;
                _surface.screenHeight = Screen.height;
                _surface.sceneCameraCullingMask = _camera.cullingMask;
                _surface.sceneCameraTargetDisplay = _camera.targetDisplay;
                _surface.sceneCameraDepth = _camera.depth;
                _surface.sceneCameraRect = RectToArray(_camera.rect);
                _surface.sceneCameraPixelRect = RectToArray(_camera.pixelRect);
                UniversalAdditionalCameraData data =
                    _camera.GetComponent<UniversalAdditionalCameraData>();
                _surface.universalAdditionalCameraDataPresent = data != null;
                if (data != null)
                {
                    _surface.universalCameraRenderType = data.renderType.ToString();
                    _surface.universalCameraStackCount = data.renderType == CameraRenderType.Base &&
                        data.cameraStack != null
                            ? data.cameraStack.Count
                            : 0;
                    _surface.universalRenderPostProcessing = data.renderPostProcessing;
                }
                if (_surface.sceneCameraPixelWidth != _owner._cameraProfile.Output.Width ||
                    _surface.sceneCameraPixelHeight != _owner._cameraProfile.Output.Height ||
                    _surface.screenWidth != _owner._cameraProfile.Output.Width ||
                    _surface.screenHeight != _owner._cameraProfile.Output.Height ||
                    !_surface.universalAdditionalCameraDataPresent ||
                    !String.Equals(
                        _surface.universalCameraRenderType,
                        CameraRenderType.Base.ToString(),
                        StringComparison.Ordinal) ||
                    _surface.universalCameraStackCount != 0)
                {
                    throw new InvalidOperationException(
                        "The scene camera is not an unstacked 1600x900 URP base camera.");
                }
            }

            private void CaptureOverlayInventory()
            {
                var canvasReceipts = new List<SnapFrameCanvasReceipt>();
                bool unsafeCanvas = false;
                Canvas[] canvases = Resources.FindObjectsOfTypeAll<Canvas>();
                foreach (Canvas canvas in canvases)
                {
                    if (canvas == null || !canvas.enabled || canvas.gameObject == null ||
                        !canvas.gameObject.activeInHierarchy)
                    {
                        continue;
                    }
                    Camera worldCamera = canvas.worldCamera;
                    int layer = canvas.gameObject.layer;
                    bool layerIncluded = (_camera.cullingMask & (1 << layer)) != 0;
                    bool worldCameraMatches = IsLiveCamera(worldCamera) &&
                        worldCamera.GetInstanceID() == _cameraInstanceId;
                    bool canRenderThrough =
                        canvas.renderMode == UnityEngine.RenderMode.WorldSpace ||
                        canvas.renderMode == UnityEngine.RenderMode.ScreenSpaceCamera &&
                            (worldCamera == null || worldCameraMatches);
                    unsafeCanvas |= canRenderThrough;
                    canvasReceipts.Add(new SnapFrameCanvasReceipt
                    {
                        instanceId = canvas.GetInstanceID(),
                        name = canvas.name,
                        renderMode = canvas.renderMode.ToString(),
                        layer = layer,
                        layerName = LayerMask.LayerToName(layer),
                        worldCameraInstanceId = IsLiveCamera(worldCamera)
                            ? worldCamera.GetInstanceID()
                            : 0,
                        worldCameraMatchesSceneCamera = worldCameraMatches,
                        layerIncludedBySceneCamera = layerIncluded,
                        canRenderThroughSceneCamera = canRenderThrough
                    });
                }
                _surface.activeCanvases = canvasReceipts;
                _surface.unsafeRenderThroughCanvasObserved |= unsafeCanvas;

                string[] currentOverlayNames = Resources.FindObjectsOfTypeAll<GameObject>()
                    .Where(candidate => candidate != null && candidate.activeInHierarchy &&
                        IsKnownCaptureOverlayName(candidate.name))
                    .Select(candidate => candidate.name)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(candidate => candidate, StringComparer.Ordinal)
                    .ToArray();
                string[] overlayNames = (_surface.knownActiveCaptureOverlayNames ??
                        new string[0])
                    .Concat(currentOverlayNames)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(candidate => candidate, StringComparer.Ordinal)
                    .ToArray();
                _surface.knownActiveCaptureOverlayNames = overlayNames;
                _surface.knownActiveCaptureOverlayCount = overlayNames.Length;
            }

            private void RequireNoUnsafeSurfaceContributor()
            {
                if (!_surface.sceneCameraTargetTextureNullBefore ||
                    !_surface.captureViewAbsentBefore ||
                    _surface.knownActiveCaptureOverlayCount != 0 ||
                    _surface.unsafeRenderThroughCanvasObserved ||
                    _owner._sceneManager.IsGridVisible ||
                    _owner._sceneManager.IsSceneGizmoVisible ||
                    _owner._sceneManager.ShowTrajectory ||
                    _owner._sceneManager.SceneCameraInteraction ||
                    _owner._sceneManager.SceneCameraScreenRenderer)
                {
                    throw new InvalidOperationException(
                        "A target texture, capture view, canvas, overlay, grid, gizmo, trajectory, interaction, or screen-renderer state could contaminate SnapFrame.");
                }
            }

            private void RequireCheckpoint(Checkpoint checkpoint, int expectedFrameRenderTextureId)
            {
                ThrowIfAbortedOrStopped();
                if (_feature == null || SnapFrameCaptureFeature.Instance == null ||
                    SnapFrameCaptureFeature.Instance.GetInstanceID() != _featureInstanceId ||
                    !IsLiveCamera(_feature.TargetCamera) ||
                    _feature.TargetCamera.GetInstanceID() != _cameraInstanceId ||
                    _camera.targetTexture != null ||
                    _owner._captureManager.IsCaptureViewVisible)
                {
                    throw new InvalidOperationException(
                        "The SnapFrame feature, exact target camera, or clean capture surface drifted.");
                }
                RenderTexture frameRenderTexture = _feature.FrameRT;
                if (frameRenderTexture == null || !frameRenderTexture.IsCreated() ||
                    frameRenderTexture.GetInstanceID() != expectedFrameRenderTextureId)
                {
                    throw new InvalidOperationException(
                        "The vendor-owned SnapFrame RenderTexture drifted during the four-frame handshake.");
                }
                bool targetNull = _camera.targetTexture == null;
                bool captureViewAbsent = !_owner._captureManager.IsCaptureViewVisible;
                CaptureOverlayInventory();
                bool cleanView = targetNull && captureViewAbsent &&
                    _surface.knownActiveCaptureOverlayCount == 0 &&
                    !_surface.unsafeRenderThroughCanvasObserved &&
                    !_owner._sceneManager.IsGridVisible &&
                    !_owner._sceneManager.IsSceneGizmoVisible &&
                    !_owner._sceneManager.ShowTrajectory &&
                    !_owner._sceneManager.SceneCameraInteraction &&
                    !_owner._sceneManager.SceneCameraScreenRenderer &&
                    _camera.cullingMask == _surface.sceneCameraCullingMask &&
                    _camera.targetDisplay == _surface.sceneCameraTargetDisplay &&
                    RectArraysEqual(RectToArray(_camera.rect), _surface.sceneCameraRect) &&
                    RectArraysEqual(RectToArray(_camera.pixelRect), _surface.sceneCameraPixelRect);
                _surface.cleanViewStateVerifiedAtEveryCheckpoint &= cleanView;
                if (!cleanView)
                {
                    throw new InvalidOperationException(
                        "The exact scene-camera or clean-view state drifted during the SnapFrame handshake.");
                }
                if (checkpoint == Checkpoint.AfterDirtyRequest)
                {
                    _surface.sceneCameraTargetTextureNullAfterDirtyRequest = targetNull;
                    _surface.captureViewAbsentAfterDirtyRequest = captureViewAbsent;
                }
                else if (checkpoint == Checkpoint.BeforeReadback)
                {
                    _surface.sceneCameraTargetTextureNullBeforeReadback = targetNull;
                    _surface.captureViewAbsentBeforeReadback = captureViewAbsent;
                }
                else if (checkpoint == Checkpoint.After)
                {
                    _surface.sceneCameraTargetTextureNullAfter = targetNull;
                    _surface.captureViewAbsentAfter = captureViewAbsent;
                }
            }

            private SnapFrameRenderTextureObservationReceipt ObserveAndRequireFrameRenderTexture(
                int observationFrame,
                int expectedInstanceId)
            {
                RenderTexture frameRenderTexture = _feature.FrameRT;
                var receipt = new SnapFrameRenderTextureObservationReceipt
                {
                    observationFrame = observationFrame,
                    instanceId = frameRenderTexture == null ? 0 : frameRenderTexture.GetInstanceID(),
                    isLive = frameRenderTexture != null,
                    isCreated = frameRenderTexture != null && frameRenderTexture.IsCreated(),
                    width = frameRenderTexture == null ? 0 : frameRenderTexture.width,
                    height = frameRenderTexture == null ? 0 : frameRenderTexture.height,
                    depth = frameRenderTexture == null ? 0 : frameRenderTexture.depth,
                    antiAliasing = frameRenderTexture == null ? 0 : frameRenderTexture.antiAliasing,
                    colorFormat = frameRenderTexture == null
                        ? null
                        : frameRenderTexture.format.ToString(),
                    graphicsFormat = frameRenderTexture == null
                        ? null
                        : frameRenderTexture.graphicsFormat.ToString(),
                    sRgb = frameRenderTexture != null && frameRenderTexture.sRGB,
                    useMipMap = frameRenderTexture != null && frameRenderTexture.useMipMap,
                    autoGenerateMips = frameRenderTexture != null && frameRenderTexture.autoGenerateMips
                };
                if (!receipt.isLive || !receipt.isCreated ||
                    receipt.width != _owner._cameraProfile.Output.Width ||
                    receipt.height != _owner._cameraProfile.Output.Height ||
                    receipt.width != _camera.pixelWidth || receipt.height != _camera.pixelHeight ||
                    receipt.depth != 0 || receipt.antiAliasing != 1 ||
                    receipt.useMipMap || receipt.autoGenerateMips ||
                    expectedInstanceId != 0 && receipt.instanceId != expectedInstanceId)
                {
                    throw new InvalidOperationException(
                        "The public SnapFrame FrameRT is not one stable, created, single-sample 1600x900 no-mipmap surface.");
                }
                if (_frameRenderTextureInstanceId == 0)
                {
                    _frameRenderTextureInstanceId = receipt.instanceId;
                }
                else if (_frameRenderTextureInstanceId != receipt.instanceId)
                {
                    throw new InvalidOperationException(
                        "The public SnapFrame FrameRT was reallocated during a capture attempt.");
                }
                return receipt;
            }

            private Texture2D ReadFrameRenderTexture(
                RenderTexture frameRenderTexture,
                SnapFrameReadbackReceipt readback)
            {
                if (frameRenderTexture == null || readback == null ||
                    !frameRenderTexture.IsCreated() ||
                    frameRenderTexture.GetInstanceID() != _frameRenderTextureInstanceId)
                {
                    throw new InvalidOperationException(
                        "SnapFrame readback did not receive the stable vendor-owned FrameRT.");
                }
                RenderTexture previousActive = RenderTexture.active;
                readback.renderTextureActiveWasNullBeforeReadback = previousActive == null;
                readback.renderTextureActiveBeforeReadbackInstanceId = previousActive == null
                    ? 0
                    : previousActive.GetInstanceID();
                Texture2D texture = null;
                Exception readbackFailure = null;
                try
                {
                    RenderTexture.active = frameRenderTexture;
                    RenderTexture active = RenderTexture.active;
                    readback.renderTextureActiveBoundForReadbackInstanceId = active == null
                        ? 0
                        : active.GetInstanceID();
                    readback.activeFrameRenderTextureVerifiedBeforeReadPixels =
                        active != null && active.GetInstanceID() == _frameRenderTextureInstanceId;
                    if (!readback.activeFrameRenderTextureVerifiedBeforeReadPixels)
                    {
                        throw new InvalidOperationException(
                            "RenderTexture.active did not bind the vendor SnapFrame FrameRT.");
                    }
                    texture = new Texture2D(
                        _owner._cameraProfile.Output.Width,
                        _owner._cameraProfile.Output.Height,
                        TextureFormat.RGB24,
                        false);
                    readback.firstPartyTextureInstanceId = texture.GetInstanceID();
                    readback.firstPartyTextureFormat = texture.format.ToString();
                    texture.ReadPixels(
                        new Rect(
                            0.0f,
                            0.0f,
                            _owner._cameraProfile.Output.Width,
                            _owner._cameraProfile.Output.Height),
                        0,
                        0,
                        false);
                    readback.firstPartyReadPixelsCompleted = true;
                    texture.Apply(false, false);
                    readback.firstPartyApplyCompleted = true;
                    readback.firstPartyTextureReadable = texture.isReadable;
                    readback.firstPartyTextureNoMipChain = texture.mipmapCount == 1;
                    readback.firstPartyTextureDistinctFromVendorFrameRenderTexture =
                        texture.GetInstanceID() != _frameRenderTextureInstanceId;
                    readback.vendorFrameRenderTextureDestroyRequested = false;
                    if (!readback.firstPartyTextureReadable ||
                        !readback.firstPartyTextureNoMipChain ||
                        !readback.firstPartyTextureDistinctFromVendorFrameRenderTexture ||
                        texture.format != TextureFormat.RGB24)
                    {
                        throw new InvalidDataException(
                            "The first-party SnapFrame texture is not distinct readable RGB24 without mip levels.");
                    }
                }
                catch (Exception exception)
                {
                    readbackFailure = exception;
                }
                finally
                {
                    RenderTexture.active = readback.renderTextureActiveWasNullBeforeReadback
                        ? null
                        : previousActive;
                    RenderTexture restored = RenderTexture.active;
                    readback.renderTextureActiveWasNullAfterReadback = restored == null;
                    readback.renderTextureActiveAfterReadbackInstanceId = restored == null
                        ? 0
                        : restored.GetInstanceID();
                    readback.renderTextureActiveRestored =
                        readback.renderTextureActiveWasNullBeforeReadback
                            ? restored == null
                            : restored != null && restored.GetInstanceID() ==
                                readback.renderTextureActiveBeforeReadbackInstanceId;
                }
                if (!readback.renderTextureActiveRestored)
                {
                    if (texture != null)
                    {
                        UnityEngine.Object.Destroy(texture);
                    }
                    throw new InvalidOperationException(
                        "RenderTexture.active was not restored after SnapFrame readback.",
                        readbackFailure);
                }
                if (readbackFailure != null)
                {
                    if (texture != null)
                    {
                        UnityEngine.Object.Destroy(texture);
                    }
                    throw new InvalidOperationException(
                        "First-party SnapFrame RGB24 readback failed.",
                        readbackFailure);
                }
                RenderTexture current = _feature.FrameRT;
                if (current == null || !current.IsCreated() ||
                    current.GetInstanceID() != _frameRenderTextureInstanceId)
                {
                    UnityEngine.Object.Destroy(texture);
                    throw new InvalidOperationException(
                        "The vendor-owned SnapFrame FrameRT drifted across first-party readback.");
                }
                return texture;
            }

            private void ApplyPose(Vector3 position, Quaternion rotation)
            {
                _owner._cameraService.SetTransform(position, rotation);
                _owner._sceneManager.SceneCameraPosition = position;
                _owner._sceneManager.SceneCameraRotation = rotation;
                _owner.ApplyProjection(_camera);
            }

            private void RestoreExactCameraState()
            {
                ApplyPose(_exactPosition, _exactRotation);
                _owner._lccSceneManager.SetFOV(
                    _owner._cameraProfile.Output.Width,
                    _owner._cameraProfile.Output.Height,
                    (float)_owner._cameraProfile.Projection.VerticalFieldOfViewDegrees,
                    (float)_owner._cameraProfile.Projection.Aspect);
                _owner._lccSceneManager.ForceRerenderer();
            }

            private void CaptureExactCameraAfterState()
            {
                _surface.exactPositionAfter = ToArray(_camera.transform.position);
                _surface.exactRotationXyzwAfter = ToArray(_camera.transform.rotation);
                _surface.exactWorldToCameraMatrixColumnMajorAfter =
                    MatrixToColumnMajor(_camera.worldToCameraMatrix);
                _surface.exactProjectionMatrixColumnMajorAfter =
                    MatrixToColumnMajor(_camera.projectionMatrix);
                _surface.exactRestoreVerified = ExactCameraStateMatches();
            }

            private bool ExactCameraStateMatches()
            {
                return PoseMatches(
                    _camera,
                    _exactPosition,
                    _exactRotation,
                    _exactWorldToCamera) &&
                    MatrixApproximatelyEqual(_camera.projectionMatrix, _exactProjection) &&
                    _camera.targetTexture == null;
            }

            private void SetStage(
                string stage,
                Vector3 expectedPosition,
                Quaternion expectedRotation,
                Matrix4x4 expectedWorldToCamera)
            {
                _stage = stage;
                _stageExpectedPosition = expectedPosition;
                _stageExpectedRotation = expectedRotation;
                _stageExpectedWorldToCamera = expectedWorldToCamera;
            }

            private void Subscribe()
            {
                RenderPipelineManager.beginCameraRendering += _beginHandler;
                RenderPipelineManager.endCameraRendering += _endHandler;
                _subscribed = true;
            }

            private void Unsubscribe()
            {
                if (!_subscribed)
                {
                    return;
                }
                RenderPipelineManager.beginCameraRendering -= _beginHandler;
                RenderPipelineManager.endCameraRendering -= _endHandler;
                _subscribed = false;
                _surface.cameraCallbackSubscriptionRemoved = true;
            }

            private void HandleBeginCameraRendering(
                ScriptableRenderContext context,
                Camera callbackCamera)
            {
                RecordCameraCallback("begin", callbackCamera);
            }

            private void HandleEndCameraRendering(
                ScriptableRenderContext context,
                Camera callbackCamera)
            {
                RecordCameraCallback("end", callbackCamera);
            }

            private void RecordCameraCallback(string callback, Camera callbackCamera)
            {
                if (callbackCamera == null || callbackCamera.GetInstanceID() != _cameraInstanceId)
                {
                    return;
                }
                if (_surface.cameraCallbacks.Count >= MaximumRecordedCameraCallbacks)
                {
                    _surface.callbackHistoryOverflowed = true;
                    return;
                }
                bool sceneCameraMatch = IsLiveCamera(_owner._sceneManager.SceneCamera) &&
                    _owner._sceneManager.SceneCamera.GetInstanceID() == _cameraInstanceId;
                bool poseMatches = PoseMatches(
                    callbackCamera,
                    _stageExpectedPosition,
                    _stageExpectedRotation,
                    _stageExpectedWorldToCamera);
                bool projectionMatches = MatrixApproximatelyEqual(
                    callbackCamera.projectionMatrix,
                    _exactProjection);
                _surface.everyCameraCallbackMatchedStagePose &=
                    sceneCameraMatch && poseMatches && projectionMatches &&
                    callbackCamera.targetTexture == null;
                RenderTexture frameRenderTexture = _feature == null ? null : _feature.FrameRT;
                var receipt = new SnapFrameCameraCallbackReceipt
                {
                    sequence = ++_callbackSequence,
                    callback = callback,
                    stage = _stage,
                    frame = Time.frameCount,
                    realtimeSeconds = Time.realtimeSinceStartup,
                    cameraMatchesExactSceneCamera = sceneCameraMatch,
                    targetTextureNull = callbackCamera.targetTexture == null,
                    poseMatchesStage = poseMatches,
                    projectionMatchesExactProfile = projectionMatches,
                    frameDirty = _feature != null && _feature.FrameDirty,
                    frameRenderTextureInstanceId = frameRenderTexture == null
                        ? 0
                        : frameRenderTexture.GetInstanceID(),
                    position = ToArray(callbackCamera.transform.position),
                    rotationXyzw = ToArray(callbackCamera.transform.rotation),
                    worldToCameraMatrixColumnMajor =
                        MatrixToColumnMajor(callbackCamera.worldToCameraMatrix),
                    projectionMatrixColumnMajor =
                        MatrixToColumnMajor(callbackCamera.projectionMatrix)
                };
                _surface.cameraCallbacks.Add(receipt);
                if (String.Equals(callback, "begin", StringComparison.Ordinal))
                {
                    _surface.beginCameraRenderingCallbackCount += 1;
                }
                else
                {
                    _surface.endCameraRenderingCallbackCount += 1;
                }
            }

            private SnapFrameCameraCallbackReceipt RequireStageEndCallback(
                string stage,
                int minimumExclusiveFrame,
                bool expectedDirty)
            {
                SnapFrameCameraCallbackReceipt receipt = _surface.cameraCallbacks
                    .Where(candidate =>
                        String.Equals(candidate.callback, "end", StringComparison.Ordinal) &&
                        String.Equals(candidate.stage, stage, StringComparison.Ordinal) &&
                        candidate.frame > minimumExclusiveFrame &&
                        candidate.cameraMatchesExactSceneCamera &&
                        candidate.targetTextureNull &&
                        candidate.poseMatchesStage &&
                        candidate.projectionMatchesExactProfile &&
                        candidate.frameDirty == expectedDirty)
                    .OrderBy(candidate => candidate.sequence)
                    .FirstOrDefault();
                if (receipt == null)
                {
                    throw new InvalidOperationException(
                        "The exact scene camera did not produce the required " + stage +
                        " endCameraRendering callback with FrameDirty=" +
                        expectedDirty.ToString(CultureInfo.InvariantCulture) + ".");
                }
                return receipt;
            }

            private void ThrowIfAbortedOrStopped()
            {
                if (Volatile.Read(ref _abortRequested) != 0 || _cancellation.IsCancellationRequested)
                {
                    throw new OperationCanceledException(
                        "The SnapFrame operation was cancelled before completion.");
                }
                _owner.ThrowIfStopped();
            }

            private bool PoseMatches(
                Camera camera,
                Vector3 expectedPosition,
                Quaternion expectedRotation,
                Matrix4x4 expectedWorldToCamera)
            {
                if (camera == null)
                {
                    return false;
                }
                double tolerance = _owner._cameraProfile.Frames.Native.AssertionTolerance;
                float rotationDot = Quaternion.Dot(camera.transform.rotation, expectedRotation);
                return IsFinite(camera.transform.position.x) &&
                    IsFinite(camera.transform.position.y) &&
                    IsFinite(camera.transform.position.z) &&
                    IsFinite(expectedPosition.x) && IsFinite(expectedPosition.y) &&
                    IsFinite(expectedPosition.z) && IsFinite(rotationDot) &&
                    Math.Abs(camera.transform.position.x - expectedPosition.x) <= tolerance &&
                    Math.Abs(camera.transform.position.y - expectedPosition.y) <= tolerance &&
                    Math.Abs(camera.transform.position.z - expectedPosition.z) <= tolerance &&
                    Math.Abs(rotationDot) >= 0.999999 &&
                    MatrixApproximatelyEqual(camera.worldToCameraMatrix, expectedWorldToCamera);
            }

            private static bool MatrixApproximatelyEqual(Matrix4x4 left, Matrix4x4 right)
            {
                for (int row = 0; row < 4; row += 1)
                {
                    for (int column = 0; column < 4; column += 1)
                    {
                        float leftValue = left[row, column];
                        float rightValue = right[row, column];
                        if (!IsFinite(leftValue) || !IsFinite(rightValue) ||
                            Math.Abs(leftValue - rightValue) >
                            CapturePolicy.ProjectionTolerance)
                        {
                            return false;
                        }
                    }
                }
                return true;
            }

            private static bool IsLiveCamera(Camera camera)
            {
                return camera != null;
            }

            private static bool IsKnownCaptureOverlayName(string name)
            {
                if (String.IsNullOrEmpty(name))
                {
                    return false;
                }
                string normalized = name.Replace("_", String.Empty)
                    .Replace("-", String.Empty)
                    .Replace(" ", String.Empty)
                    .ToLowerInvariant();
                return String.Equals(normalized, "captureview", StringComparison.Ordinal) ||
                    String.Equals(normalized, "capturemask", StringComparison.Ordinal);
            }

            private static SnapFrameDirtyObservationReceipt ToDirtyObservation(
                SnapFrameCameraCallbackReceipt callback)
            {
                return new SnapFrameDirtyObservationReceipt
                {
                    observationFrame = callback.frame,
                    dirty = callback.frameDirty
                };
            }

            private static float[] RectToArray(Rect value)
            {
                return new[] { value.x, value.y, value.width, value.height };
            }

            private static bool RectArraysEqual(float[] left, float[] right)
            {
                if (left == null || right == null || left.Length != 4 || right.Length != 4)
                {
                    return false;
                }
                for (int index = 0; index < 4; index += 1)
                {
                    if (!IsFinite(left[index]) || !IsFinite(right[index]) ||
                        Math.Abs(left[index] - right[index]) >
                            CapturePolicy.ProjectionTolerance)
                    {
                        return false;
                    }
                }
                return true;
            }

            private enum Checkpoint
            {
                Before,
                AfterDirtyRequest,
                BeforeReadback,
                After
            }
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
            internal bool EnvironmentExclusionRequested;
            internal bool HasEnvironment;
            internal CameraReceipt Receipt;
        }
    }
}
