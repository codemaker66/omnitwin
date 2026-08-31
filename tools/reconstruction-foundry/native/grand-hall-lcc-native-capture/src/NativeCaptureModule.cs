using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using Cysharp.Threading.Tasks;
using LCCCore;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
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
        private const string ModuleVersion = "1.7.0";
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
        private const string FinalRawRgb24FileName =
            "grand-hall-native-capture-1600x900.unorm-lower-left.rgb24";
        private const string FinalExpandedSrgbTagged16PngFileName =
            "grand-hall-native-capture-1600x900.srgb-tagged-expanded16.png";

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
        private SingleCameraRenderRequestOperation _activeSingleCameraRenderRequestOperation;

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
            SingleCameraRenderRequestOperation requestOperation = Volatile.Read(
                ref _activeSingleCameraRenderRequestOperation);
            if (requestOperation != null)
            {
                requestOperation.Abort();
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
            FinalizeCaptureArtifacts(receipt.capture);
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
                schemaVersion = "venviewer.grand-hall.lcc-native-capture-receipt.v14",
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
                    "Three consecutive byte-identical, decoded, non-degenerate lower-left Unity-Gamma R8G8B8A8_UNorm RGB24 display-code hashes establish a same-host pixel plateau before row reversal and PNG tagging and only after the conservative readiness gate; they do not prove every possible streamed Gaussian is resident.",
                    "The UNorm target and RGB24 readback prove stored display code values and orientation, not linear-light photometry or an exact photometric transfer. PNG8 preserves those code values exactly after row reversal and tags the result as sRGB for browser display; PNG16 expands each 8-bit value exactly by value*257 and adds no precision.",
                    "SetRenderAll(true) is applied in the synchronous lccscene.load.begin handler after renderer initialization and before the canonical Renderer.Load call, then observed again after lccscene.loaded. The public API still exposes no loaded-splat residency count or streaming-completion metric, so readiness also requires a minimum 300 rendered frames and 15 seconds before hash sampling.",
                    "The locked vendor SetRenderAll method writes a pending next-load field while IsRenderAll reads the active loaded-dataset field. Cleanup requests pending false without claiming a public read-back; disposable process exit is the final isolation boundary.",
                    "Each first-party readback operation has cooperative cancellation at every end-of-frame await and restores the exact camera in its async finally block. It still cannot preempt a blocked Unity main thread, ReadPixels GPU synchronization, or native driver call; the external operator process watchdog and disposable process exit remain the hard boundary.",
                    "Admission pixels come only from a first-party RGB24 ReadPixels of a module-owned 1600x900 sRGB RenderTexture supplied directly as the destination of the locked URP UniversalRenderPipeline.SingleCameraRequest. This is a new standalone exact-camera render, not the displayed screen backbuffer, vendor FrameRT, Camera.Render, the previously rejected generic Camera.targetTexture lane, or an ICaptureManager-returned Texture2D.",
                    "The locked LCCWorld SceneCameraScreenRenderer getter is true exactly when its private temporary render target is null; setting the property false allocates that vendor target and assigns it to the camera. The clean request boundary therefore requires the getter to remain true and the original camera target to remain null before and after URP temporarily binds the exact owned destination.",
                    "Before the capability preflight, a synchronous public-getter-only URP inventory records the locked pipeline asset, renderer-data and feature configuration without creating a missing renderer. If RenderPipelineManager.currentPipeline is null, the locked Unity 6000.0.60f1 public SupportsRenderRequest contract performs Unity-owned runtime initialization inside this disposable process. The receipt records that transition and does not claim renderer-instance identity remained stable across initialization or that no runtime lifecycle mutation occurred.",
                    "The renderer-data and feature configuration signature must remain byte-identical across Unity-owned initialization. A separate full renderer-instance signature is established only after initialization and must remain stable through both request renders. No persistent pipeline-asset mutation is claimed, and process exit is the ownership boundary for Unity-created runtime renderer instances.",
                    "The public side-effect-free URP surface does not expose the scene camera's serialized renderer index. A sole non-null renderer-data/renderer pair is labelled an inference rather than an observed camera binding; ScriptableRendererFeature.isActive is only the base feature toggle and does not prove AddRenderPasses ran for this camera.",
                    "Every attempt performs two synchronous SingleCameraRequest renders: a discarded five-centimetre sentinel and a restored exact-pose request. Each request must emit exactly beginContext, beginCamera, endCamera, and endContext in one frame for only the exact scene camera while its target is the owned destination. The sentinel and exact RGB24 hashes must be non-degenerate and distinct.",
                    "The fresh XGRIDS scene creates one self-mode marker and one avatar spawn marker. Every Unity Renderer below each exact AnchorScale3D is forceRenderingOff only during sentinel/exact submission and readback, with loaded-scene cardinality, closure identity, hierarchy, state, SceneDirty checkpoints, reverse-order restoration, and retryable finally cleanup receipted. No owner or GameObject is deactivated.",
                    "Raw ReadPixels bytes are preserved unchanged as lower-left Unity-Gamma R8G8B8A8_UNorm RGB24 display-code evidence. The deterministic browser PNG8 uses an integrity-checked identity LUT, while the sRGB-tagged PNG16 uses an integrity-checked exact value*257 expansion LUT and adds no precision. Both retain strict sRGB/gAMA/cHRM, chunk-order, CRC, Adler, filter, orientation, decoded-sample and trailing-byte verification.",
                    "The locked URP SingleCameraRequest Tex2D/mip-zero path temporarily binds the owned destination directly, renders and submits one camera, emits its context/camera callbacks, and restores the original camera target. No first-party renderer-data, renderer-feature, camera-stack, blit, copy, command-buffer, or manual-submit API is called by this module. The configured SnapFrame feature may be instantiated by Unity-owned pipeline initialization, but the module never activates it, targets it, invokes its API, or uses its FrameRT or pixels. Screen-space overlay canvases are excluded by the non-null request-target contract, while camera-space and in-mask world-space canvases, known capture overlays, visible capture view, and uncontrolled view helpers are rejected.",
                    "The active vendor LCCCore.CameraDraw end-camera callback is recorded as a potential contributor and its locked call graph can reach a 78-by-13 bottom-right watermark draw. The native result therefore remains reconstructed diagnostic evidence until visual QA explicitly checks that region, orientation and architectural fidelity.",
                    "In the locked vendor implementation, SupportFullRender(Ultra) is a current-scene splat-budget eligibility predicate, not an API-capability flag. Its false result for this 6,019,684-finest-splat package is recorded as telemetry and is not substituted for the observed IsRenderAll state.",
                    "Environment data is explicitly requested false for browser-frontier parity, excluding env.sog. The public API exposes no environment-visibility getter, so this receipt records the request and does not claim read-back visibility.",
                    "The runtime closure hashes every regular file in the disposable editor tree except this first-party module. It does not close over the GPU driver, operating system, CodeMeter service, firmware, or external per-user configuration.",
                    "Pixel hashes are not promised to remain identical across GPU drivers, graphics APIs, Unity builds, or LCCSDK versions.",
                    "The module adds no generated fill, neighboring-room asset, facade asset, window, doorway, or architectural edit; it renders only the locked native GH_1 LCC2 package.",
                    "This native receipt is durably written before Application.Quit and cannot characterize the later vendor teardown. Operator v4 separately requires exactly one complete profile from its closed shutdown-profile set: a clean exception-free tail or one exact named vendor-exception limitation shape. It rejects incomplete, unclassified, mixed, reordered, wrong-count, pre-receipt, or extended exception evidence.",
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
            capture.surface =
                "ISceneManager.SceneCamera through a module-owned 1600x900 URP SingleCameraRequest " +
                "RenderTexture, exact four-event render transcript, first-party RGB24 ReadPixels, " +
                "immutable lower-left R8G8B8A8_UNorm RGB24 code-value evidence, and deterministic tagged sRGB PNG8/PNG16 derivatives";
            capture.renderCallbackSurface =
                "RenderPipelineManager beginContext/beginCamera/endCamera/endContext for exactly the " +
                "scene camera and owned request target";
            capture.configuredPixelSource = CapturePolicy.SingleCameraRenderRequestPixelSource;
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
                string rawRgb24CandidatePath = Path.Combine(
                    _outputDirectory,
                    ".native-unorm-rgb24-candidate-" +
                        ordinal.ToString("D3", CultureInfo.InvariantCulture) + ".rgb24");
                string expandedSrgbTagged16CandidatePath = Path.Combine(
                    _outputDirectory,
                    ".native-srgb-tagged-expanded16-candidate-" +
                    ordinal.ToString("D3", CultureInfo.InvariantCulture) + ".png");
                var attempt = new CaptureAttemptReceipt
                {
                    ordinal = ordinal,
                    status = "running",
                    width = _cameraProfile.Output.Width,
                    height = _cameraProfile.Output.Height,
                    firstSrpEndCameraRenderingFrame = -1,
                    lastSrpEndCameraRenderingFrame = -1,
                    underlyingCaptureCancellationAvailable = false,
                    singleCameraRenderRequestSurface =
                        new SingleCameraRenderRequestSurfaceReceipt()
                };
                capture.attempts.Add(attempt);
                try
                {
                    if (File.Exists(candidatePath) ||
                        File.Exists(rawRgb24CandidatePath) ||
                        File.Exists(expandedSrgbTagged16CandidatePath))
                    {
                        throw new IOException(
                            "One or more capture candidate artifact paths already exist for ordinal " +
                            ordinal.ToString(CultureInfo.InvariantCulture) + ".");
                    }

                    RequireLockedCameraState(state);
                    ThrowIfStopped();
                    await PopulateCaptureAttemptAsync(
                        state,
                        rawRgb24CandidatePath,
                        candidatePath,
                        expandedSrgbTagged16CandidatePath,
                        attempt);
                    ThrowIfStopped();

                    consecutive = String.Equals(
                            previousHash,
                            attempt.plateauHashSha256,
                            StringComparison.Ordinal)
                        ? consecutive + 1
                        : 1;
                    previousHash = attempt.plateauHashSha256;
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
                    capture.selectedRawRgb24AttemptPath = rawRgb24CandidatePath;
                    capture.selectedBrowserDisplaySrgbTaggedExpanded16AttemptPath =
                        expandedSrgbTagged16CandidatePath;
                    capture.sameHostHashPlateauVerified = true;
                    return;
                }
            }

            capture.elapsedSeconds = stopwatch.Elapsed.TotalSeconds;
            throw new TimeoutException(
                "The native renderer did not produce three consecutive byte-identical 1600x900 R8G8B8A8_UNorm RGB24 rasters within " +
                CapturePolicy.MaximumCaptureAttempts.ToString(CultureInfo.InvariantCulture) + " attempts and " +
                CapturePolicy.MaximumConvergenceSeconds.ToString("R", CultureInfo.InvariantCulture) + " seconds.");
        }

        private async UniTask PopulateCaptureAttemptAsync(
            CameraState state,
            string rawRgb24CandidatePath,
            string displaySrgb8CandidatePath,
            string expandedSrgbTagged16CandidatePath,
            CaptureAttemptReceipt attempt)
        {
            if (state == null || state.Camera == null)
            {
                throw new ArgumentNullException("state");
            }
            Texture2D texture = null;
            byte[] rawRgb24Bytes = null;
            byte[] browserDisplaySrgbTagged8PngBytes = null;
            byte[] browserDisplaySrgbTaggedExpanded16PngBytes = null;
            SrgbTaggedDisplayFrame browserDisplaySrgbTagged8 = null;
            SrgbTaggedDisplayFrame browserDisplaySrgbTaggedExpanded16 = null;
            try
            {
                texture = await CaptureSingleCameraRequestTextureWithTimeout(state, attempt);
                ThrowIfStopped();
                if (texture == null)
                {
                    throw new InvalidDataException(
                        "The first-party SingleCameraRequest readback returned a null texture.");
                }
                if (texture.width != _cameraProfile.Output.Width ||
                    texture.height != _cameraProfile.Output.Height)
                {
                    throw new InvalidDataException(
                        "The first-party SingleCameraRequest readback returned unexpected dimensions.");
                }

                if (!String.Equals(
                    attempt.firstPartyTextureFormat,
                    texture.format.ToString(),
                    StringComparison.Ordinal) ||
                    attempt.firstPartyTextureInstanceId != texture.GetInstanceID())
                {
                    throw new InvalidDataException(
                        "The transferred first-party SingleCameraRequest texture differs from the readback receipt.");
                }
                attempt.firstPartyTextureReadable = texture.isReadable;
                attempt.firstPartyTextureNoMipChain = texture.mipmapCount == 1;
                if (!attempt.firstPartyTextureReadable || !attempt.firstPartyTextureNoMipChain)
                {
                    throw new InvalidDataException(
                        "The first-party SingleCameraRequest texture is not readable RGB24 without mip levels.");
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
                CapturePolicy.RequireSingleCameraRenderRequestExactRasterBinding(
                    attempt.singleCameraRenderRequestSurface,
                    attempt.raster);

                var unityGammaUnorm = DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                    _cameraProfile.Output.Width,
                    _cameraProfile.Output.Height,
                    RasterRowOrigin.LowerLeft,
                    rgb24);
                if (!String.Equals(
                        unityGammaUnorm.Sha256,
                        attempt.raster.rgb24Sha256,
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "The immutable Unity-Gamma UNorm RGB24 display-code frame differs from the admitted raster.");
                }

                // Exact UNorm display-code admission deliberately precedes row reversal and PNG tagging.
                rawRgb24Bytes = unityGammaUnorm.CopyBytes();
                attempt.plateauHashDomain =
                    "lower_left_Unity_Gamma_R8G8B8A8_UNorm_display_code_rgb24_sha256_before_row_flip_and_sRGB_tagging";
                attempt.plateauHashSha256 = unityGammaUnorm.Sha256;
                attempt.rawRgb24Semantics = DisplayEncodingPolicy.RawRgb24Semantics;
                attempt.rawRgb24LinearLightPhotometryClaimed =
                    DisplayEncodingPolicy.RawRgb24LinearLightPhotometryClaimed;
                attempt.rawRgb24CandidatePath = rawRgb24CandidatePath;
                attempt.rawRgb24ByteLength = unityGammaUnorm.ByteLength;
                attempt.rawRgb24Sha256 = unityGammaUnorm.Sha256;
                attempt.browserDisplay8CodeMapping =
                    DisplayEncodingPolicy.BrowserDisplay8CodeMapping;
                attempt.browserDisplay16CodeMapping =
                    DisplayEncodingPolicy.BrowserDisplay16CodeMapping;
                attempt.exactPhotometricTransferClaimed =
                    DisplayEncodingPolicy.ExactPhotometricTransferClaimed;
                attempt.expanded16AddsPrecision =
                    DisplayEncodingPolicy.Expanded16AddsPrecision;

                browserDisplaySrgbTagged8 =
                    DisplayEncodingPolicy.MapIdentityToSrgbTagged8(unityGammaUnorm);
                browserDisplaySrgbTaggedExpanded16 =
                    DisplayEncodingPolicy.ExpandToSrgbTagged16(unityGammaUnorm);
                browserDisplaySrgbTagged8PngBytes =
                    DeterministicPng.Encode(browserDisplaySrgbTagged8);
                browserDisplaySrgbTaggedExpanded16PngBytes =
                    DeterministicPng.Encode(browserDisplaySrgbTaggedExpanded16);
                DeterministicPngVerification browserDisplaySrgbTagged8Verification =
                    DeterministicPng.VerifyAndDecode(
                        browserDisplaySrgbTagged8PngBytes,
                        RasterRowOrigin.LowerLeft);
                DeterministicPngVerification browserDisplaySrgbTaggedExpanded16Verification =
                    DeterministicPng.VerifyAndDecode(
                        browserDisplaySrgbTaggedExpanded16PngBytes,
                        RasterRowOrigin.LowerLeft);
                RequireDeterministicDisplayPng(
                    browserDisplaySrgbTagged8Verification,
                    browserDisplaySrgbTagged8,
                    8,
                    DisplayEncodingPolicy.Sha256Bytes(browserDisplaySrgbTagged8PngBytes));
                RequireDeterministicDisplayPng(
                    browserDisplaySrgbTaggedExpanded16Verification,
                    browserDisplaySrgbTaggedExpanded16,
                    16,
                    DisplayEncodingPolicy.Sha256Bytes(
                        browserDisplaySrgbTaggedExpanded16PngBytes));

                attempt.browserDisplaySrgbTagged8SampleSha256 =
                    browserDisplaySrgbTagged8.Sha256;
                attempt.browserDisplaySrgbTagged8CandidatePath = displaySrgb8CandidatePath;
                attempt.browserDisplaySrgbTagged8BitDepth = 8;
                attempt.browserDisplaySrgbTagged8PngEncodingCompleted = true;
                attempt.browserDisplaySrgbTagged8PngChunksVerified = true;
                attempt.browserDisplaySrgbTagged8EncodedByteLength =
                    browserDisplaySrgbTagged8PngBytes.LongLength;
                attempt.browserDisplaySrgbTagged8EncodedSha256 =
                    browserDisplaySrgbTagged8Verification.PngSha256;
                attempt.browserDisplaySrgbTaggedExpanded16SampleSha256 =
                    browserDisplaySrgbTaggedExpanded16.Sha256;
                attempt.browserDisplaySrgbTaggedExpanded16CandidatePath =
                    expandedSrgbTagged16CandidatePath;
                attempt.browserDisplaySrgbTaggedExpanded16BitDepth = 16;
                attempt.browserDisplaySrgbTaggedExpanded16PngEncodingCompleted = true;
                attempt.browserDisplaySrgbTaggedExpanded16PngChunksVerified = true;
                attempt.browserDisplaySrgbTaggedExpanded16EncodedByteLength =
                    browserDisplaySrgbTaggedExpanded16PngBytes.LongLength;
                attempt.browserDisplaySrgbTaggedExpanded16EncodedSha256 =
                    browserDisplaySrgbTaggedExpanded16Verification.PngSha256;

                // Compatibility aliases describe the browser-facing PNG8 artifact.
                attempt.pngEncodingCompleted = true;
                attempt.encodedByteLength = browserDisplaySrgbTagged8PngBytes.LongLength;
                attempt.encodedSha256 = browserDisplaySrgbTagged8Verification.PngSha256;
            }
            finally
            {
                if (texture != null)
                {
                    UnityEngine.Object.Destroy(texture);
                }
            }

            ThrowIfStopped();
            WriteNoReplaceBytes(rawRgb24CandidatePath, rawRgb24Bytes);
            var rawRgb24Info = new FileInfo(rawRgb24CandidatePath);
            string rawRgb24FileSha256 =
                CapturePolicy.Sha256File(rawRgb24CandidatePath);
            if (rawRgb24Info.Length != attempt.rawRgb24ByteLength ||
                !String.Equals(
                    rawRgb24FileSha256,
                    attempt.rawRgb24Sha256,
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    "The durably published raw UNorm RGB24 evidence differs from its admitted raster.");
            }
            attempt.rawRgb24BytePublicationCompleted = true;
            attempt.rawRgb24PostWriteFileShaVerified = true;

            WriteNoReplaceBytes(
                expandedSrgbTagged16CandidatePath,
                browserDisplaySrgbTaggedExpanded16PngBytes);
            WriteNoReplaceBytes(
                displaySrgb8CandidatePath,
                browserDisplaySrgbTagged8PngBytes);
            CapturePolicy.RequirePngDimensions(
                displaySrgb8CandidatePath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            CapturePolicy.RequirePngDimensions(
                expandedSrgbTagged16CandidatePath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            byte[] publishedSrgb8 = File.ReadAllBytes(displaySrgb8CandidatePath);
            byte[] publishedSrgb16 = File.ReadAllBytes(expandedSrgbTagged16CandidatePath);
            DeterministicPngVerification publishedSrgb8Verification =
                DeterministicPng.VerifyAndDecode(
                    publishedSrgb8,
                    RasterRowOrigin.LowerLeft);
            DeterministicPngVerification publishedSrgb16Verification =
                DeterministicPng.VerifyAndDecode(
                    publishedSrgb16,
                    RasterRowOrigin.LowerLeft);
            RequireDeterministicDisplayPng(
                publishedSrgb8Verification,
                browserDisplaySrgbTagged8,
                8,
                attempt.browserDisplaySrgbTagged8EncodedSha256);
            RequireDeterministicDisplayPng(
                publishedSrgb16Verification,
                browserDisplaySrgbTaggedExpanded16,
                16,
                attempt.browserDisplaySrgbTaggedExpanded16EncodedSha256);
            var displaySrgb8Info = new FileInfo(displaySrgb8CandidatePath);
            var displaySrgb16Info = new FileInfo(expandedSrgbTagged16CandidatePath);
            if (displaySrgb8Info.Length != attempt.browserDisplaySrgbTagged8EncodedByteLength ||
                displaySrgb16Info.Length !=
                    attempt.browserDisplaySrgbTaggedExpanded16EncodedByteLength)
            {
                throw new InvalidDataException(
                    "A durably published display PNG differs in byte length from its encoded payload.");
            }

            attempt.browserDisplaySrgbTagged8PostWriteFileShaVerified = true;
            attempt.browserDisplaySrgbTaggedExpanded16PostWriteFileShaVerified = true;
            attempt.sha256 = publishedSrgb8Verification.PngSha256;
            attempt.byteLength = displaySrgb8Info.Length;
            attempt.postWriteFileShaVerified = true;
        }

        private static void RequireDeterministicDisplayPng(
            DeterministicPngVerification verification,
            SrgbTaggedDisplayFrame expectedFrame,
            int expectedBitDepth,
            string expectedPngSha256)
        {
            if (verification == null || expectedFrame == null ||
                verification.Width != expectedFrame.Width ||
                verification.Height != expectedFrame.Height ||
                verification.BitDepth != expectedBitDepth ||
                verification.RenderingIntent != DeterministicPng.SrgbRenderingIntent ||
                verification.Gamma != DeterministicPng.SrgbGamma ||
                !String.Equals(
                    String.Join(",", verification.CopyChunkSequence()),
                    DeterministicPng.ChunkSequence,
                    StringComparison.Ordinal) ||
                !verification.AllChunkCrcsVerified ||
                !verification.ZlibStoredBlocksVerified ||
                !verification.Adler32Verified ||
                !verification.FilterZeroVerified ||
                !verification.NoTrailingBytesVerified ||
                verification.DecodedFrame == null ||
                verification.DecodedFrame.RowOrigin != RasterRowOrigin.LowerLeft ||
                !String.Equals(
                    verification.DecodedFrame.Sha256,
                    expectedFrame.Sha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    verification.PngSha256,
                    expectedPngSha256,
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    "A deterministic sRGB display PNG failed strict metadata, checksum, orientation, or sample verification.");
            }
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
            capture.everyAttemptSpawnPointVisualizationsSuppressedAndRestored =
                capture.attempts.Count > 0 && capture.attempts.All(candidate =>
                    String.Equals(candidate.status, "accepted", StringComparison.Ordinal) &&
                    candidate.singleCameraRenderRequestSurface != null &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression != null &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression
                        .leaseHeldDuringEveryAcceptedAttempt &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression.everyTargetSuppressed &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression.everyTargetRestored &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression
                        .sceneDirtyEqualAtEveryCheckpoint &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression
                        .identityStableAtEveryCheckpoint &&
                    candidate.singleCameraRenderRequestSurface
                        .spawnPointVisualizationSuppression.disposed);
        }

        private async UniTask<Texture2D> CaptureSingleCameraRequestTextureWithTimeout(
            CameraState state,
            CaptureAttemptReceipt attempt)
        {
            if (state == null || state.Camera == null)
            {
                throw new ArgumentNullException("state");
            }
            ThrowIfStopped();
            var operation = new SingleCameraRenderRequestOperation(this, state, attempt);
            CancellationTokenSource deadlineCancellation = null;
            Texture2D completedTexture = null;
            bool completedTextureReturned = false;
            try
            {
                if (Interlocked.CompareExchange(
                    ref _activeSingleCameraRenderRequestOperation,
                    operation,
                    null) != null)
                {
                    throw new InvalidOperationException(
                        "A second SingleCameraRequest operation cannot overlap the active operation.");
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
                            "The cancelled SingleCameraRequest operation failed during owned-resource cleanup.",
                            cleanupFailure);
                    }
                    if (_lifecycle.IsStopped)
                    {
                        attempt.captureTaskStopObserved = true;
                        throw new OperationCanceledException(
                            "Stop cancelled the SingleCameraRequest operation outside its synchronous submit call.");
                    }
                    attempt.captureTaskTimeoutObserved = true;
                    throw new TimeoutException(
                        "The SingleCameraRequest operation exceeded the cooperative player-loop deadline of " +
                        CapturePolicy.PerCaptureTimeoutSeconds.ToString("R", CultureInfo.InvariantCulture) +
                        " seconds. SubmitRenderRequest is synchronous and non-cancellable; a blocked Unity main " +
                        "thread or GPU remains bounded only by disposable process exit.");
                }

                attempt.captureTaskCompletedBeforeDeadline = true;
                ThrowIfStopped();
                if (completedTexture == null)
                {
                    throw new InvalidDataException(
                        "The SingleCameraRequest operation returned a null first-party texture.");
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
                    ref _activeSingleCameraRenderRequestOperation,
                    null,
                    operation);
                operation.Dispose();
            }
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

        private void FinalizeCaptureArtifacts(CaptureReceipt capture)
        {
            if (!capture.sameHostHashPlateauVerified ||
                !capture.everyAttemptSpawnPointVisualizationsSuppressedAndRestored ||
                String.IsNullOrEmpty(capture.selectedAttemptPath) ||
                String.IsNullOrEmpty(capture.selectedRawRgb24AttemptPath) ||
                String.IsNullOrEmpty(
                    capture.selectedBrowserDisplaySrgbTaggedExpanded16AttemptPath))
            {
                throw new InvalidOperationException(
                    "A stable, marker-free raw/display candidate set does not exist.");
            }

            string finalPath = Path.Combine(_outputDirectory, FinalPngFileName);
            string rawRgb24FinalPath = Path.Combine(
                _outputDirectory,
                FinalRawRgb24FileName);
            string expandedSrgbTagged16FinalPath = Path.Combine(
                _outputDirectory,
                FinalExpandedSrgbTagged16PngFileName);
            if (File.Exists(finalPath) || File.Exists(rawRgb24FinalPath) ||
                File.Exists(expandedSrgbTagged16FinalPath))
            {
                throw new IOException(
                    "One or more final native capture artifact paths already exist.");
            }

            CapturePolicy.RequirePngDimensions(
                capture.selectedAttemptPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            CapturePolicy.RequirePngDimensions(
                capture.selectedBrowserDisplaySrgbTaggedExpanded16AttemptPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            byte[] selectedSrgb8Bytes = File.ReadAllBytes(capture.selectedAttemptPath);
            byte[] selectedSrgbTaggedExpanded16Bytes = File.ReadAllBytes(
                capture.selectedBrowserDisplaySrgbTaggedExpanded16AttemptPath);
            byte[] selectedRawRgb24Bytes = File.ReadAllBytes(
                capture.selectedRawRgb24AttemptPath);
            CaptureAttemptReceipt selected = capture.attempts[capture.attempts.Count - 1];
            if (!String.Equals(
                    DisplayEncodingPolicy.Sha256Bytes(selectedRawRgb24Bytes),
                    selected.rawRgb24Sha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    DisplayEncodingPolicy.Sha256Bytes(selectedSrgb8Bytes),
                    selected.browserDisplaySrgbTagged8EncodedSha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    DisplayEncodingPolicy.Sha256Bytes(selectedSrgbTaggedExpanded16Bytes),
                    selected.browserDisplaySrgbTaggedExpanded16EncodedSha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    selected.plateauHashSha256,
                    selected.rawRgb24Sha256,
                    StringComparison.Ordinal) ||
                selectedRawRgb24Bytes.LongLength != selected.rawRgb24ByteLength ||
                !String.Equals(
                    selected.rawRgb24Semantics,
                    DisplayEncodingPolicy.RawRgb24Semantics,
                    StringComparison.Ordinal) ||
                selected.rawRgb24LinearLightPhotometryClaimed ||
                selected.exactPhotometricTransferClaimed ||
                selected.expanded16AddsPrecision ||
                !String.Equals(
                    selected.browserDisplay8CodeMapping,
                    DisplayEncodingPolicy.BrowserDisplay8CodeMapping,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    selected.browserDisplay16CodeMapping,
                    DisplayEncodingPolicy.BrowserDisplay16CodeMapping,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "A selected raw or display candidate changed before finalization.");
            }

            UnityGammaUnormRgb24Frame selectedUnityGammaUnorm =
                DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height,
                RasterRowOrigin.LowerLeft,
                    selectedRawRgb24Bytes);
            SrgbTaggedDisplayFrame expectedSrgbTagged8 =
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(selectedUnityGammaUnorm);
            SrgbTaggedDisplayFrame expectedSrgbTaggedExpanded16 =
                DisplayEncodingPolicy.ExpandToSrgbTagged16(selectedUnityGammaUnorm);
            RequireDeterministicDisplayPng(
                DeterministicPng.VerifyAndDecode(
                    selectedSrgb8Bytes,
                    RasterRowOrigin.LowerLeft),
                expectedSrgbTagged8,
                8,
                selected.browserDisplaySrgbTagged8EncodedSha256);
            RequireDeterministicDisplayPng(
                DeterministicPng.VerifyAndDecode(
                    selectedSrgbTaggedExpanded16Bytes,
                    RasterRowOrigin.LowerLeft),
                expectedSrgbTaggedExpanded16,
                16,
                selected.browserDisplaySrgbTaggedExpanded16EncodedSha256);

            WriteNoReplaceBytes(rawRgb24FinalPath, selectedRawRgb24Bytes);
            WriteNoReplaceBytes(
                expandedSrgbTagged16FinalPath,
                selectedSrgbTaggedExpanded16Bytes);
            WriteNoReplaceBytes(finalPath, selectedSrgb8Bytes);
            CapturePolicy.RequirePngDimensions(
                finalPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);
            CapturePolicy.RequirePngDimensions(
                expandedSrgbTagged16FinalPath,
                _cameraProfile.Output.Width,
                _cameraProfile.Output.Height);

            var rawRgb24Info = new FileInfo(rawRgb24FinalPath);
            var expandedSrgbTagged16Info = new FileInfo(expandedSrgbTagged16FinalPath);
            var finalInfo = new FileInfo(finalPath);
            string rawRgb24Sha256 = CapturePolicy.Sha256File(rawRgb24FinalPath);
            string expandedSrgbTagged16Sha256 =
                CapturePolicy.Sha256File(expandedSrgbTagged16FinalPath);
            string finalSha256 = CapturePolicy.Sha256File(finalPath);
            if (!String.Equals(
                    rawRgb24Sha256,
                    selected.rawRgb24Sha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    expandedSrgbTagged16Sha256,
                    selected.browserDisplaySrgbTaggedExpanded16EncodedSha256,
                    StringComparison.Ordinal) ||
                !String.Equals(
                    finalSha256,
                    selected.browserDisplaySrgbTagged8EncodedSha256,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "A final raw or display artifact differs from its stable candidate.");
            }

            capture.plateauHashDomain = selected.plateauHashDomain;
            capture.rawRgb24Semantics = selected.rawRgb24Semantics;
            capture.rawRgb24LinearLightPhotometryClaimed =
                selected.rawRgb24LinearLightPhotometryClaimed;
            capture.rawRgb24EvidencePath = rawRgb24FinalPath;
            capture.rawRgb24EvidenceByteLength = rawRgb24Info.Length;
            capture.rawRgb24EvidenceSha256 = rawRgb24Sha256;
            capture.exactPhotometricTransferClaimed =
                DisplayEncodingPolicy.ExactPhotometricTransferClaimed;
            capture.expanded16AddsPrecision = DisplayEncodingPolicy.Expanded16AddsPrecision;
            capture.browserDisplaySrgbTaggedExpanded16PngPath =
                expandedSrgbTagged16FinalPath;
            capture.browserDisplaySrgbTaggedExpanded16PngByteLength =
                expandedSrgbTagged16Info.Length;
            capture.browserDisplaySrgbTaggedExpanded16PngSha256 =
                expandedSrgbTagged16Sha256;
            capture.browserDisplaySrgbTaggedExpanded16PngChunksVerified = true;
            capture.finalBrowserDisplayCodeMapping =
                DisplayEncodingPolicy.BrowserDisplay8CodeMapping;
            capture.finalExpanded16CodeMapping =
                DisplayEncodingPolicy.BrowserDisplay16CodeMapping;
            capture.finalPngSrgbTagsVerified = true;
            capture.finalPngPath = finalPath;
            capture.finalPngByteLength = finalInfo.Length;
            capture.finalPngSha256 = finalSha256;
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
            string rawRgb24Path = Path.Combine(
                _outputDirectory,
                ".native-unorm-rgb24-candidate-" +
                pruneThrough.ToString("D3", CultureInfo.InvariantCulture) + ".rgb24");
            string expandedSrgbTagged16Path = Path.Combine(
                _outputDirectory,
                ".native-srgb-tagged-expanded16-candidate-" +
                pruneThrough.ToString("D3", CultureInfo.InvariantCulture) + ".png");
            foreach (string candidatePath in new[]
                {
                    path,
                    rawRgb24Path,
                    expandedSrgbTagged16Path
                })
            {
                if (File.Exists(candidatePath))
                {
                    File.Delete(candidatePath);
                }
            }
        }

        private CaptureReceipt CreateInitialCaptureReceipt()
        {
            RenderPipelineAsset pipelineAsset = GraphicsSettings.currentRenderPipeline;
            return new CaptureReceipt
            {
                surface = "ISceneManager.SceneCamera through a module-owned Gamma-space R8G8B8A8_UNorm non-sRGB URP SingleCameraRequest destination, exact render-request callback transcript, immutable lower-left display-code RGB24 evidence, an identity-mapped sRGB-tagged browser PNG8, and an exact value*257 sRGB-tagged PNG16 expansion",
                imageFormat = "UNITY_GAMMA_R8G8B8A8_UNORM_RGB24_DISPLAY_CODES_PLUS_IDENTITY_SRGB_TAGGED_PNG8_AND_EXACT_EXPANDED_PNG16",
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
                perCaptureTimeoutSemantics = "cooperative_around_synchronous_non_cancellable_submit_with_exact_camera_and_owned_resource_finally_restore",
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
                renderCallbackSurface = "RenderPipelineManager beginContext/beginCamera/endCamera/endContext for exactly the SceneCamera and owned request target",
                globalCameraCallbackRequiredForAdmission = true,
                standardCameraRenderCallbackProofAvailable = false,
                pipelineAssetType = pipelineAsset == null
                    ? "null"
                    : pipelineAsset.GetType().AssemblyQualifiedName,
                configuredPixelSource = CapturePolicy.SingleCameraRenderRequestPixelSource,
                observedPixelSource = null,
                everyObservedPixelSourceMatchesConfigured = false,
                blackChannelThreshold = CapturePolicy.BlackChannelThreshold,
                minimumNonBlackPixelFraction = CapturePolicy.MinimumNonBlackPixelFraction,
                minimumMaximumChannelDynamicRange = CapturePolicy.MinimumMaximumChannelDynamicRange,
                minimumDistinctRgbCount = CapturePolicy.MinimumDistinctRgbCount,
                minimumLuminanceStandardDeviation = CapturePolicy.MinimumLuminanceStandardDeviation,
                everyAttemptDecodedAndNonDegenerate = false,
                everyAttemptSpawnPointVisualizationsSuppressedAndRestored = false,
                plateauHashDomain =
                    "lower_left_Unity_Gamma_R8G8B8A8_UNorm_display_code_rgb24_sha256_before_row_flip_and_sRGB_tagging",
                rawRgb24Semantics = DisplayEncodingPolicy.RawRgb24Semantics,
                rawRgb24LinearLightPhotometryClaimed =
                    DisplayEncodingPolicy.RawRgb24LinearLightPhotometryClaimed,
                exactPhotometricTransferClaimed =
                    DisplayEncodingPolicy.ExactPhotometricTransferClaimed,
                expanded16AddsPrecision = DisplayEncodingPolicy.Expanded16AddsPrecision,
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

        private sealed class SpawnPointVisualizationSuppressionLease
        {
            private sealed class TargetState
            {
                internal UnityEngine.Renderer Renderer;
                internal bool ForceRenderingOffBefore;
                internal bool RendererEnabledBefore;
                internal bool ActiveInHierarchyBefore;
                internal int LayerBefore;
                internal int GameObjectInstanceId;
                internal string HierarchyPath;
                internal SpawnPointVisualizationTargetReceipt Receipt;
            }

            private sealed class OwnerState
            {
                internal string Role;
                internal Component Owner;
                internal SpawnPointElement Element;
                internal XGrids.LCCWorld.Common.Components.AnchorScale3D Anchor;
                internal TargetState[] Targets;
            }

            private readonly NativeCaptureModule _owner;
            private readonly Camera _camera;
            private readonly List<TargetState> _targets = new List<TargetState>();
            private readonly List<OwnerState> _owners = new List<OwnerState>();
            private readonly SpawnPointVisualizationSuppressionReceipt _receipt;
            private bool _suppressionStarted;
            private bool _suppressed;
            private bool _restoreInProgress;
            private bool _restoreCompleted;
            private bool _sceneDirtyFailureObserved;

            internal SpawnPointVisualizationSuppressionLease(
                NativeCaptureModule owner,
                Camera camera)
            {
                if (owner == null)
                {
                    throw new ArgumentNullException("owner");
                }
                if (camera == null)
                {
                    throw new ArgumentNullException("camera");
                }

                _owner = owner;
                _camera = camera;
                _receipt = new SpawnPointVisualizationSuppressionReceipt
                {
                    purpose =
                        "exclude_only_generated_self_and_avatar_spawn_point_anchor_visualizations_from_exact_native_pixels",
                    selectionContract =
                        "exactly_one_loaded_active_enabled_SelfModeSpawnPointComponent_and_AvatarSpawnPointComponent_in_one_scene_each_with_one_loaded_active_enabled_SpawnPointElement_AnchorScale3D_and_every_descendant_UnityEngine.Renderer_forceRenderingOff",
                    mutationApi = "UnityEngine.Renderer.forceRenderingOff",
                    targets = new List<SpawnPointVisualizationTargetReceipt>(),
                    unexpectedRenderPathComponentTypeNames = new string[0]
                };
            }

            internal SpawnPointVisualizationSuppressionReceipt Receipt
            {
                get { return _receipt; }
            }

            internal void Suppress()
            {
                if (_suppressionStarted || _suppressed || _restoreCompleted)
                {
                    throw new InvalidOperationException(
                        "Spawn-point visualization suppression was requested more than once.");
                }

                _receipt.sceneDirtyBefore = _owner._sceneManager.SceneDirty;
                _receipt.sceneDirtyWhileSuppressed = _receipt.sceneDirtyBefore;
                _receipt.sceneDirtyFalseAtEntry = !_receipt.sceneDirtyBefore;
                _receipt.sceneDirtyEqualAtEveryCheckpoint =
                    _receipt.sceneDirtyFalseAtEntry;
                if (!_receipt.sceneDirtyFalseAtEntry)
                {
                    throw new InvalidOperationException(
                        "The fresh temporary scene is already dirty before spawn-point suppression.");
                }

                SelfModeSpawnPointComponent[] selfLoaded =
                    Resources.FindObjectsOfTypeAll<SelfModeSpawnPointComponent>()
                        .Where(IsLoadedSceneComponent)
                        .ToArray();
                AvatarSpawnPointComponent[] avatarLoaded =
                    Resources.FindObjectsOfTypeAll<AvatarSpawnPointComponent>()
                        .Where(IsLoadedSceneComponent)
                        .ToArray();
                SelfModeSpawnPointComponent[] selfActive = selfLoaded
                    .Where(IsActiveEnabledSceneBehaviour)
                    .ToArray();
                AvatarSpawnPointComponent[] avatarActive = avatarLoaded
                    .Where(IsActiveEnabledSceneBehaviour)
                    .ToArray();
                _receipt.selfModeOwnerLoadedSceneCount = selfLoaded.Length;
                _receipt.avatarOwnerLoadedSceneCount = avatarLoaded.Length;
                _receipt.selfModeOwnerActiveEnabledCount = selfActive.Length;
                _receipt.avatarOwnerActiveEnabledCount = avatarActive.Length;
                if (selfLoaded.Length != 1 || avatarLoaded.Length != 1 ||
                    selfActive.Length != 1 || avatarActive.Length != 1 ||
                    selfActive[0].gameObject.scene.handle !=
                        avatarActive[0].gameObject.scene.handle)
                {
                    throw new InvalidOperationException(
                        "The fresh scene must contain exactly one loaded, active, enabled self owner and avatar owner in the same scene.");
                }

                _receipt.expectedSceneHandle = selfActive[0].gameObject.scene.handle;
                _receipt.expectedScenePath = selfActive[0].gameObject.scene.path;
                int selfTotalElements;
                int selfActiveElements;
                int selfInitiallyRenderable;
                AddOwnerTargets(
                    "self_mode",
                    selfActive[0],
                    out selfTotalElements,
                    out selfActiveElements,
                    out selfInitiallyRenderable);
                int avatarTotalElements;
                int avatarActiveElements;
                int avatarInitiallyRenderable;
                AddOwnerTargets(
                    "avatar",
                    avatarActive[0],
                    out avatarTotalElements,
                    out avatarActiveElements,
                    out avatarInitiallyRenderable);
                _receipt.selfModeVisualizationElementTotalCount = selfTotalElements;
                _receipt.avatarVisualizationElementTotalCount = avatarTotalElements;
                _receipt.selfModeVisualizationElementActiveEnabledCount =
                    selfActiveElements;
                _receipt.avatarVisualizationElementActiveEnabledCount =
                    avatarActiveElements;
                _receipt.selfModeInitiallyRenderableTargetCount =
                    selfInitiallyRenderable;
                _receipt.avatarInitiallyRenderableTargetCount =
                    avatarInitiallyRenderable;
                _receipt.initiallyRenderableTargetCount =
                    selfInitiallyRenderable + avatarInitiallyRenderable;
                if (selfTotalElements != 1 || avatarTotalElements != 1 ||
                    selfActiveElements != 1 || avatarActiveElements != 1 ||
                    selfInitiallyRenderable < 1 || avatarInitiallyRenderable < 1 ||
                    _targets.Count < 2 ||
                    _targets.Select(candidate => candidate.Renderer.GetInstanceID())
                        .Distinct().Count() != _targets.Count)
                {
                    throw new InvalidOperationException(
                        "The two generated spawn-point anchors lack a unique, complete renderer closure with one initially visible target per role.");
                }

                string[] unexpected = _owners
                    .SelectMany(candidate => FindUnexpectedRenderPathTypes(candidate.Anchor))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(candidate => candidate, StringComparer.Ordinal)
                    .ToArray();
                _receipt.unexpectedRenderPathComponentTypeNames = unexpected;
                _receipt.unexpectedRenderPathAbsent = unexpected.Length == 0;
                if (!_receipt.unexpectedRenderPathAbsent)
                {
                    throw new InvalidOperationException(
                        "A spawn-point anchor contains a non-Renderer visual path: " +
                        String.Join(", ", unexpected));
                }

                _receipt.targetCount = _targets.Count;
                _suppressionStarted = true;
                try
                {
                    foreach (TargetState target in _targets)
                    {
                        target.Receipt.suppressionRequested = true;
                        _receipt.forceRenderingOffSetterCallCount += 1;
                        target.Renderer.forceRenderingOff = true;
                        ObserveCleanScene();
                        target.Receipt.forceRenderingOffObservedWhileSuppressed =
                            target.Renderer.forceRenderingOff;
                        if (!target.Receipt.forceRenderingOffObservedWhileSuppressed)
                        {
                            throw new InvalidOperationException(
                                "A generated spawn-point anchor renderer rejected forceRenderingOff=true.");
                        }
                    }

                    _suppressed = true;
                    RequireSuppressed();
                    _receipt.everyTargetSuppressed = true;
                }
                catch (Exception suppressionFailure)
                {
                    try
                    {
                        Restore();
                    }
                    catch (Exception restoreFailure)
                    {
                        throw new AggregateException(
                            "Spawn-point suppression failed and exact restoration also failed.",
                            suppressionFailure,
                            restoreFailure);
                    }
                    throw;
                }
            }

            internal void MarkSentinelRequestAndReadbackComplete()
            {
                RequireSuppressed();
                _receipt.coveredSentinelRequestAndReadback = true;
            }

            internal void MarkExactRequestAndReadbackComplete()
            {
                RequireSuppressed();
                _receipt.coveredExactRequestAndReadback = true;
                _receipt.leaseHeldDuringEveryAcceptedAttempt =
                    _receipt.coveredSentinelRequestAndReadback &&
                    _receipt.coveredExactRequestAndReadback;
            }

            internal void RequireSuppressed()
            {
                if (!_suppressionStarted || !_suppressed || _restoreCompleted)
                {
                    throw new InvalidOperationException(
                        "The generated spawn-point visualization suppression lease is not intact.");
                }
                ObserveCleanScene();
                RequireIdentityClosure(true);
                _receipt.sceneDirtyWhileSuppressed = _owner._sceneManager.SceneDirty;
            }

            internal void Restore()
            {
                if (_restoreCompleted)
                {
                    try
                    {
                        RequireRestored();
                        return;
                    }
                    catch
                    {
                        _restoreCompleted = false;
                        _receipt.disposed = false;
                    }
                }
                if (!_suppressionStarted)
                {
                    return;
                }
                if (_restoreInProgress)
                {
                    throw new InvalidOperationException(
                        "Spawn-point restoration re-entered before its prior attempt completed.");
                }

                _restoreInProgress = true;
                _receipt.restoreAttemptCount += 1;
                var failures = new List<Exception>();
                try
                {
                    for (int index = _targets.Count - 1; index >= 0; index -= 1)
                    {
                        TargetState target = _targets[index];
                        try
                        {
                            target.Receipt.restorationRequested = true;
                            if (target.Renderer == null)
                            {
                                throw new InvalidOperationException(
                                    "A generated spawn-point anchor renderer was destroyed before restoration.");
                            }
                            _receipt.forceRenderingOffSetterCallCount += 1;
                            target.Renderer.forceRenderingOff =
                                target.ForceRenderingOffBefore;
                            ObserveCleanScene();
                            CaptureRestoredTargetState(target);
                            if (!target.Receipt.exactRendererStateRestored)
                            {
                                throw new InvalidOperationException(
                                    "A generated spawn-point anchor renderer did not restore its exact entry state.");
                            }
                        }
                        catch (Exception exception)
                        {
                            failures.Add(exception);
                        }
                    }

                    try
                    {
                        RequireIdentityClosure(false);
                        ObserveCleanScene();
                    }
                    catch (Exception exception)
                    {
                        failures.Add(exception);
                    }

                    _receipt.sceneDirtyAfter = _owner._sceneManager.SceneDirty;
                    _receipt.sceneDirtyEqualAtEveryCheckpoint =
                        !_sceneDirtyFailureObserved &&
                        !_receipt.sceneDirtyBefore &&
                        !_receipt.sceneDirtyWhileSuppressed &&
                        !_receipt.sceneDirtyAfter;
                    _receipt.everyTargetRestored = failures.Count == 0 &&
                        _targets.All(candidate =>
                            candidate.Receipt.exactRendererStateRestored);
                    if (failures.Count > 0 ||
                        !_receipt.sceneDirtyEqualAtEveryCheckpoint ||
                        !_receipt.everyTargetRestored)
                    {
                        if (failures.Count == 1)
                        {
                            throw failures[0];
                        }
                        throw new AggregateException(failures);
                    }

                    _suppressed = false;
                    _restoreCompleted = true;
                    _receipt.disposed = true;
                    try
                    {
                        RequireRestored();
                    }
                    catch
                    {
                        _restoreCompleted = false;
                        _receipt.disposed = false;
                        throw;
                    }
                }
                finally
                {
                    _restoreInProgress = false;
                }
            }

            internal void RequireRestored()
            {
                if (!_restoreCompleted || !_receipt.everyTargetRestored ||
                    !_receipt.sceneDirtyEqualAtEveryCheckpoint ||
                    !_receipt.identityStableAtEveryCheckpoint ||
                    !_receipt.disposed)
                {
                    throw new InvalidOperationException(
                        "The generated spawn-point visualization suppression lease lacks exact restoration proof.");
                }
                ObserveCleanScene();
                RequireIdentityClosure(false);
            }

            private void AddOwnerTargets<T>(
                string role,
                T ownerComponent,
                out int totalElementCount,
                out int activeElementCount,
                out int initiallyRenderableCount)
                where T : Component
            {
                SpawnPointElement[] elements = ownerComponent
                    .GetComponentsInChildren<SpawnPointElement>(true)
                    .Where(candidate => candidate != null)
                    .ToArray();
                totalElementCount = elements.Length;
                activeElementCount = elements.Count(IsActiveEnabledSceneBehaviour);
                initiallyRenderableCount = 0;
                if (totalElementCount != 1 || activeElementCount != 1)
                {
                    return;
                }

                SpawnPointElement element = elements[0];
                XGrids.LCCWorld.Common.Components.AnchorScale3D anchor =
                    element.AnchorScale3D;
                if (anchor == null || !IsActiveEnabledSceneBehaviour(anchor) ||
                    (anchor.transform != element.transform &&
                        !anchor.transform.IsChildOf(element.transform)) ||
                    ownerComponent.gameObject.scene.handle !=
                        _receipt.expectedSceneHandle ||
                    element.gameObject.scene.handle != _receipt.expectedSceneHandle ||
                    anchor.gameObject.scene.handle != _receipt.expectedSceneHandle)
                {
                    throw new InvalidOperationException(
                        "A generated spawn-point element lacks one active, enabled, in-scene anchor_scale_3d descendant.");
                }

                UnityEngine.Renderer[] renderers = GetRendererClosure(anchor);
                if (renderers.Length == 0)
                {
                    throw new InvalidOperationException(
                        "A generated spawn-point anchor exposes no UnityEngine.Renderer descendants.");
                }

                var ownerTargets = new List<TargetState>();
                foreach (UnityEngine.Renderer renderer in renderers)
                {
                    bool initiallyRenderable = renderer.enabled &&
                        renderer.gameObject.activeInHierarchy &&
                        !renderer.forceRenderingOff &&
                        LayerIncludedByCamera(renderer.gameObject.layer);
                    if (initiallyRenderable)
                    {
                        initiallyRenderableCount += 1;
                    }
                    var targetReceipt = new SpawnPointVisualizationTargetReceipt
                    {
                        role = role,
                        ownerComponentTypeFullName = ownerComponent.GetType().FullName,
                        ownerComponentInstanceId = ownerComponent.GetInstanceID(),
                        ownerHierarchyPath = BuildHierarchyPath(ownerComponent.transform),
                        ownerSceneHandle = ownerComponent.gameObject.scene.handle,
                        ownerScenePath = ownerComponent.gameObject.scene.path,
                        spawnPointElementInstanceId = element.GetInstanceID(),
                        spawnPointElementHierarchyPath = BuildHierarchyPath(element.transform),
                        visualizationComponentTypeFullName = anchor.GetType().FullName,
                        visualizationComponentInstanceId = anchor.GetInstanceID(),
                        visualizationHierarchyPath = BuildHierarchyPath(anchor.transform),
                        rendererTypeFullName = renderer.GetType().FullName,
                        rendererInstanceId = renderer.GetInstanceID(),
                        rendererHierarchyPath = BuildHierarchyPath(renderer.transform),
                        rendererGameObjectInstanceId = renderer.gameObject.GetInstanceID(),
                        rendererLayer = renderer.gameObject.layer,
                        rendererLayerName = LayerMask.LayerToName(renderer.gameObject.layer),
                        rendererLayerIncludedBySceneCamera =
                            LayerIncludedByCamera(renderer.gameObject.layer),
                        rendererEnabledBefore = renderer.enabled,
                        forceRenderingOffBefore = renderer.forceRenderingOff,
                        activeInHierarchyBefore = renderer.gameObject.activeInHierarchy,
                        initiallyRenderableBySceneCamera = initiallyRenderable
                    };
                    var target = new TargetState
                    {
                        Renderer = renderer,
                        ForceRenderingOffBefore = renderer.forceRenderingOff,
                        RendererEnabledBefore = renderer.enabled,
                        ActiveInHierarchyBefore = renderer.gameObject.activeInHierarchy,
                        LayerBefore = renderer.gameObject.layer,
                        GameObjectInstanceId = renderer.gameObject.GetInstanceID(),
                        HierarchyPath = BuildHierarchyPath(renderer.transform),
                        Receipt = targetReceipt
                    };
                    _receipt.targets.Add(targetReceipt);
                    _targets.Add(target);
                    ownerTargets.Add(target);
                }
                _owners.Add(new OwnerState
                {
                    Role = role,
                    Owner = ownerComponent,
                    Element = element,
                    Anchor = anchor,
                    Targets = ownerTargets.ToArray()
                });
            }

            private void RequireIdentityClosure(bool expectSuppressed)
            {
                foreach (OwnerState owner in _owners)
                {
                    if (owner.Owner == null || owner.Element == null ||
                        owner.Anchor == null ||
                        !IsActiveEnabledSceneBehaviour(owner.Owner) ||
                        !IsActiveEnabledSceneBehaviour(owner.Element) ||
                        !IsActiveEnabledSceneBehaviour(owner.Anchor) ||
                        owner.Owner.gameObject.scene.handle !=
                            _receipt.expectedSceneHandle ||
                        owner.Element.gameObject.scene.handle !=
                            _receipt.expectedSceneHandle ||
                        owner.Anchor.gameObject.scene.handle !=
                            _receipt.expectedSceneHandle ||
                        (owner.Anchor.transform != owner.Element.transform &&
                            !owner.Anchor.transform.IsChildOf(owner.Element.transform)))
                    {
                        throw new InvalidOperationException(
                            "A generated spawn-point owner, element, anchor, or scene identity drifted.");
                    }
                    SpawnPointElement[] elements = owner.Owner
                        .GetComponentsInChildren<SpawnPointElement>(true)
                        .Where(candidate => candidate != null)
                        .ToArray();
                    if (elements.Length != 1 ||
                        !System.Object.ReferenceEquals(elements[0], owner.Element) ||
                        !System.Object.ReferenceEquals(
                            owner.Element.AnchorScale3D,
                            owner.Anchor))
                    {
                        throw new InvalidOperationException(
                            "The generated spawn-point element cardinality or anchor identity drifted.");
                    }
                    UnityEngine.Renderer[] current = GetRendererClosure(owner.Anchor);
                    if (current.Length != owner.Targets.Length ||
                        !current.Select(candidate => candidate.GetInstanceID())
                            .SequenceEqual(
                                owner.Targets.Select(candidate =>
                                    candidate.Renderer.GetInstanceID())))
                    {
                        throw new InvalidOperationException(
                            "The generated spawn-point renderer closure changed while leased.");
                    }
                    string[] unexpected = FindUnexpectedRenderPathTypes(owner.Anchor);
                    if (unexpected.Length != 0)
                    {
                        throw new InvalidOperationException(
                            "A non-Renderer visual path appeared inside a leased spawn-point anchor.");
                    }
                    foreach (TargetState target in owner.Targets)
                    {
                        if (target.Renderer == null ||
                            target.Renderer.GetInstanceID() !=
                                target.Receipt.rendererInstanceId ||
                            target.Renderer.gameObject.GetInstanceID() !=
                                target.GameObjectInstanceId ||
                            target.Renderer.gameObject.scene.handle !=
                                _receipt.expectedSceneHandle ||
                            target.Renderer.gameObject.layer != target.LayerBefore ||
                            !String.Equals(
                                BuildHierarchyPath(target.Renderer.transform),
                                target.HierarchyPath,
                                StringComparison.Ordinal) ||
                            target.Renderer.enabled != target.RendererEnabledBefore ||
                            target.Renderer.gameObject.activeInHierarchy !=
                                target.ActiveInHierarchyBefore ||
                            (expectSuppressed
                                ? !target.Renderer.forceRenderingOff
                                : target.Renderer.forceRenderingOff !=
                                    target.ForceRenderingOffBefore))
                        {
                            throw new InvalidOperationException(
                                "A generated spawn-point renderer identity or state drifted while leased.");
                        }
                    }
                }
                _receipt.identityStableAtEveryCheckpoint = true;
                foreach (TargetState target in _targets)
                {
                    target.Receipt.identityStableAtEveryCheckpoint = true;
                }
            }

            private void CaptureRestoredTargetState(TargetState target)
            {
                target.Receipt.rendererEnabledAfter = target.Renderer.enabled;
                target.Receipt.forceRenderingOffAfter =
                    target.Renderer.forceRenderingOff;
                target.Receipt.activeInHierarchyAfter =
                    target.Renderer.gameObject.activeInHierarchy;
                target.Receipt.exactRendererStateRestored =
                    target.Receipt.rendererEnabledAfter ==
                        target.RendererEnabledBefore &&
                    target.Receipt.forceRenderingOffAfter ==
                        target.ForceRenderingOffBefore &&
                    target.Receipt.activeInHierarchyAfter ==
                        target.ActiveInHierarchyBefore &&
                    target.Renderer.gameObject.layer == target.LayerBefore &&
                    target.Renderer.gameObject.GetInstanceID() ==
                        target.GameObjectInstanceId &&
                    String.Equals(
                        BuildHierarchyPath(target.Renderer.transform),
                        target.HierarchyPath,
                        StringComparison.Ordinal);
            }

            private void ObserveCleanScene()
            {
                _receipt.suppressionCheckpointCount += 1;
                if (_owner._sceneManager.SceneDirty)
                {
                    _sceneDirtyFailureObserved = true;
                    _receipt.sceneDirtyEqualAtEveryCheckpoint = false;
                    throw new InvalidOperationException(
                        "SceneDirty became true at a spawn-point suppression checkpoint.");
                }
                _receipt.sceneDirtyEqualAtEveryCheckpoint =
                    !_sceneDirtyFailureObserved;
            }

            private static UnityEngine.Renderer[] GetRendererClosure(
                XGrids.LCCWorld.Common.Components.AnchorScale3D anchor)
            {
                return anchor.GetComponentsInChildren<UnityEngine.Renderer>(true)
                    .Where(candidate => candidate != null)
                    .OrderBy(candidate => BuildHierarchyPath(candidate.transform),
                        StringComparer.Ordinal)
                    .ThenBy(candidate => candidate.GetInstanceID())
                    .ToArray();
            }

            private static string[] FindUnexpectedRenderPathTypes(Component anchor)
            {
                return anchor.GetComponentsInChildren<Component>(true)
                    .Where(candidate => candidate != null &&
                        IsUnexpectedRenderPath(candidate))
                    .Select(candidate => candidate.GetType().FullName)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(candidate => candidate, StringComparer.Ordinal)
                    .ToArray();
            }

            private static bool IsUnexpectedRenderPath(Component component)
            {
                if (component is UnityEngine.Renderer)
                {
                    return false;
                }
                if (component is Camera || component is Canvas ||
                    component is CanvasRenderer)
                {
                    return true;
                }
                Type type = component.GetType();
                string fullName = type.FullName ?? String.Empty;
                if (fullName.IndexOf("LCCRenderer", StringComparison.Ordinal) >= 0 ||
                    fullName.IndexOf("UnityEngine.VFX.VisualEffect", StringComparison.Ordinal) >= 0)
                {
                    return true;
                }
                string[] renderCallbacks =
                {
                    "OnRenderObject",
                    "OnPostRender",
                    "OnPreRender",
                    "OnWillRenderObject"
                };
                return type.GetMethods(
                        BindingFlags.Instance |
                        BindingFlags.Public |
                        BindingFlags.NonPublic |
                        BindingFlags.DeclaredOnly)
                    .Any(method => renderCallbacks.Contains(
                        method.Name,
                        StringComparer.Ordinal));
            }

            private static bool IsLoadedSceneComponent(Component component)
            {
                return component != null && component.gameObject != null &&
                    component.gameObject.scene.IsValid() &&
                    component.gameObject.scene.isLoaded;
            }

            private static bool IsActiveEnabledSceneBehaviour(Component component)
            {
                Behaviour behaviour = component as Behaviour;
                return IsLoadedSceneComponent(component) && behaviour != null &&
                    behaviour.isActiveAndEnabled;
            }

            private bool LayerIncludedByCamera(int layer)
            {
                return (_camera.cullingMask & (1 << layer)) != 0;
            }

            private static string BuildHierarchyPath(UnityEngine.Transform transform)
            {
                if (transform == null)
                {
                    return null;
                }
                var segments = new List<string>();
                UnityEngine.Transform current = transform;
                while (current != null)
                {
                    segments.Add(
                        current.name + "[" +
                        current.GetSiblingIndex().ToString(CultureInfo.InvariantCulture) + "]");
                    current = current.parent;
                }
                segments.Reverse();
                return String.Join("/", segments.ToArray());
            }
        }

        private sealed class SingleCameraRenderRequestOperation : IDisposable
        {
            private const int MaximumRecordedCallbacks = 16;
            private const string SentinelStage = "sentinel_discard";
            private const string ExactStage = "stable_exact";

            private readonly NativeCaptureModule _owner;
            private readonly CameraState _cameraState;
            private readonly Camera _camera;
            private readonly int _cameraInstanceId;
            private readonly CaptureAttemptReceipt _attempt;
            private readonly SingleCameraRenderRequestSurfaceReceipt _surface;
            private readonly CancellationTokenSource _cancellation =
                new CancellationTokenSource();
            private readonly Action<ScriptableRenderContext, List<Camera>>
                _beginContextHandler;
            private readonly Action<ScriptableRenderContext, List<Camera>>
                _endContextHandler;
            private readonly Action<ScriptableRenderContext, Camera> _beginCameraHandler;
            private readonly Action<ScriptableRenderContext, Camera> _endCameraHandler;
            private readonly Vector3 _exactPosition;
            private readonly Quaternion _exactRotation;
            private readonly Matrix4x4 _exactWorldToCamera;
            private readonly Matrix4x4 _exactProjection;
            private readonly Vector3 _sentinelPosition;
            private RenderPipeline _entryPipeline;
            private RenderPipeline _pipelineBefore;
            private RenderPipelineAsset _pipelineAssetBeforePreflight;
            private RenderTexture _ownedRenderTexture;
            private string _requestedGraphicsFormat;
            private bool _requestedSrgb;
            private RenderTexture _originalCameraTargetTexture;
            private RenderTexture _originalRenderTextureActive;
            private SingleCameraRenderRequestInvocationReceipt _activeInvocation;
            private Vector3 _stageExpectedPosition;
            private Quaternion _stageExpectedRotation;
            private Matrix4x4 _stageExpectedWorldToCamera;
            private int _callbackSequence;
            private int _requestOrdinal;
            private bool _beginContextSubscribed;
            private bool _beginCameraSubscribed;
            private bool _endCameraSubscribed;
            private bool _endContextSubscribed;
            private bool _cameraBaselineVerified;
            private bool _restoreBaselinesCaptured;
            private bool _initialSurfaceStateCompleted;
            private SpawnPointVisualizationSuppressionLease _spawnPointSuppression;
            private int _abortRequested;
            private int _disposed;

            internal SingleCameraRenderRequestOperation(
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
                _surface = attempt.singleCameraRenderRequestSurface ??
                    new SingleCameraRenderRequestSurfaceReceipt();
                _attempt.singleCameraRenderRequestSurface = _surface;
                _surface.activeCanvases = new List<NativeCanvasReceipt>();
                _surface.knownActiveCaptureOverlayNames = new string[0];
                _surface.cleanViewStateVerifiedAtEveryCheckpoint = true;
                _surface.pixelSurfaceProvenance =
                    CapturePolicy.SingleCameraRenderRequestSurfaceProvenance;
                _surface.renderBoundaryEvidence =
                    CapturePolicy.SingleCameraRenderRequestRenderBoundaryEvidence;
                _surface.lockedRequestType =
                    "UnityEngine.Rendering.Universal.UniversalRenderPipeline+SingleCameraRequest";
                _surface.urpRendererDataOrFeatureMutationApiInvoked = false;
                _surface.prohibitedFirstPartyMutationApis =
                    CapturePolicy.CreateSingleCameraRenderRequestProhibitedMutationApis();
                _surface.sceneCameraScreenRendererGetterContract =
                    CapturePolicy.SceneCameraScreenRendererGetterContract;
                _surface.sceneCameraScreenRendererSetterInvoked = false;
                _surface.snapFrameApiInvoked = false;
                _surface.snapFramePixelSourceUsed = false;
                _surface.snapFrameExecutionPrevented = false;
                _surface.cameraTargetTextureAssignedByModule = false;
                _surface.ownedRenderTextureCreatedAfterRelease = false;
                _surface.returnedTextureDestroyRequested = false;
                _surface.exactTextureOwnershipTransferred = false;
                _surface.unownedResourceDestroyOrReleaseRequested = false;
                _surface.visualQaRequired = true;
                _surface.captureAcceptanceScope =
                    CapturePolicy.SingleCameraRenderRequestAcceptanceScope;
                _surface.finalSourceFaithfulAcceptanceClaimed = false;
                _exactPosition = _camera.transform.position;
                _exactRotation = _camera.transform.rotation;
                _exactWorldToCamera = _camera.worldToCameraMatrix;
                _exactProjection = _camera.projectionMatrix;
                _sentinelPosition = _exactPosition + new Vector3(
                    (float)CapturePolicy.SnapFrameSentinelTranslationMetres,
                    0.0f,
                    0.0f);
                _beginContextHandler = HandleBeginContextRendering;
                _beginCameraHandler = HandleBeginCameraRendering;
                _endCameraHandler = HandleEndCameraRendering;
                _endContextHandler = HandleEndContextRendering;
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
                    CreateOwnedRenderTexture();
                    EstablishLockedRenderPipelineBoundary();
                    _spawnPointSuppression =
                        new SpawnPointVisualizationSuppressionLease(_owner, _camera);
                    _surface.spawnPointVisualizationSuppression =
                        _spawnPointSuppression.Receipt;
                    _spawnPointSuppression.Suppress();
                    RequireCheckpoint(_exactPosition, _exactRotation, _exactWorldToCamera);

                    ApplyPose(_sentinelPosition, _exactRotation);
                    _surface.sentinelPosition = ToArray(_sentinelPosition);
                    _surface.sentinelRotationXyzw = ToArray(_exactRotation);
                    _surface.sentinelWorldToCameraMatrixColumnMajor =
                        MatrixToColumnMajor(_camera.worldToCameraMatrix);
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
                            "The deterministic five-centimetre request sentinel pose was not reached.");
                    }
                    RequireCheckpoint(
                        _sentinelPosition,
                        _exactRotation,
                        _camera.worldToCameraMatrix);
                    _spawnPointSuppression.RequireSuppressed();
                    _surface.sentinelRequest = ExecuteRequest(
                        SentinelStage,
                        _sentinelPosition,
                        _exactRotation,
                        _camera.worldToCameraMatrix,
                        out sentinelTexture);
                    byte[] sentinelRgb24 = ToRgb24(sentinelTexture.GetPixels32());
                    _surface.sentinelRaster = CapturePolicy.AnalyzeRgb24(
                        sentinelRgb24,
                        _owner._cameraProfile.Output.Width,
                        _owner._cameraProfile.Output.Height);
                    CapturePolicy.RequireNonDegenerateRaster(
                        _surface.sentinelRaster,
                        _owner._cameraProfile.Output.Width,
                        _owner._cameraProfile.Output.Height);
                    _spawnPointSuppression.MarkSentinelRequestAndReadbackComplete();
                    UnityEngine.Object.Destroy(sentinelTexture);
                    _surface.sentinelTextureDestroyRequested = true;
                    sentinelTexture = null;

                    RestoreExactCameraState();
                    await UniTask.WaitForEndOfFrame(_cancellation.Token);
                    ThrowIfAbortedOrStopped();
                    CaptureExactCameraAfterState();
                    if (!_surface.exactRestoreVerified)
                    {
                        throw new InvalidOperationException(
                            "The exact inspection camera was not restored before its request render.");
                    }
                    RequireCheckpoint(
                        _exactPosition,
                        _exactRotation,
                        _exactWorldToCamera);
                    _spawnPointSuppression.RequireSuppressed();
                    _surface.exactRequest = ExecuteRequest(
                        ExactStage,
                        _exactPosition,
                        _exactRotation,
                        _exactWorldToCamera,
                        out exactTexture);
                    byte[] exactRgb24 = ToRgb24(exactTexture.GetPixels32());
                    _surface.exactFrameRgb24Sha256 =
                        CapturePolicy.Sha256Bytes(exactRgb24);
                    _surface.sentinelAndExactRgbDiffer = !String.Equals(
                        _surface.sentinelRaster.rgb24Sha256,
                        _surface.exactFrameRgb24Sha256,
                        StringComparison.OrdinalIgnoreCase);
                    if (!_surface.sentinelAndExactRgbDiffer)
                    {
                        throw new InvalidDataException(
                            "The sentinel and exact SingleCameraRequest rasters were byte-identical; fresh rendering is unproved.");
                    }
                    _spawnPointSuppression.MarkExactRequestAndReadbackComplete();
                    RestoreSpawnPointVisualizations();

                    _surface.rendererInventoryAfter =
                        SnapFrameReadbackOperation.CaptureReadOnlyUrpRendererInventory(
                            _camera);
                    CapturePolicy.RequireReadOnlyUrpRendererInventory(
                        _surface.rendererInventoryAfter);
                    _surface.rendererStateSignatureAfterSha256 =
                        CapturePolicy.ComputeUrpRendererStateSignature(
                            _surface.rendererInventoryAfter);
                    _surface.rendererDataFeatureIdentityAndActiveStateStable =
                        String.Equals(
                            _surface.rendererStateSignatureBeforeSha256,
                            _surface.rendererStateSignatureAfterSha256,
                            StringComparison.Ordinal) &&
                        _surface.rendererInventoryBefore
                            .rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory &&
                        _surface.rendererInventoryAfter
                            .rendererFeatureIdentityAndActiveStateStableDuringSynchronousInventory;
                    if (!_surface.rendererDataFeatureIdentityAndActiveStateStable)
                    {
                        throw new InvalidOperationException(
                            "The public URP renderer-data, renderer, or feature identity/state changed across request rendering.");
                    }

                    CaptureExactCameraAfterState();
                    CaptureFinalSurfaceState();
                    ReleaseAndDestroyOwnedRenderTexture();
                    RestoreRenderTextureActive();
                    _surface.renderTextureActiveRestoredAfterOperation =
                        RenderTextureActiveMatchesOriginal();
                    if (!_surface.renderTextureActiveRestoredAfterOperation)
                    {
                        throw new InvalidOperationException(
                            "RenderTexture.active was not restored after the request operation.");
                    }

                    SingleCameraRenderRequestReadbackReceipt exactReadback =
                        _surface.exactRequest.readback;
                    _attempt.firstPartyTextureInstanceId = exactTexture.GetInstanceID();
                    _attempt.firstPartyTextureFormat = exactTexture.format.ToString();
                    _attempt.firstPartyTextureReadable = exactTexture.isReadable;
                    _attempt.firstPartyTextureNoMipChain = exactTexture.mipmapCount == 1;
                    _attempt.firstPartyReadPixelsCompleted =
                        exactReadback.firstPartyReadPixelsCompleted;
                    _attempt.firstPartyApplyCompleted =
                        exactReadback.firstPartyApplyCompleted;
                    _attempt.pixelSource =
                        CapturePolicy.SingleCameraRenderRequestPixelSource;
                    _attempt.readbackTrigger =
                        "locked_urp_single_camera_request_owned_destination_direct_rgb24_readback";
                    _attempt.standardCameraRenderCallbackProofAvailable = true;
                    _attempt.srpEndCameraRenderingCallbackCount = 2;
                    _attempt.firstSrpEndCameraRenderingFrame =
                        CallbackFrame(_surface.sentinelRequest, "endCamera");
                    _attempt.lastSrpEndCameraRenderingFrame =
                        CallbackFrame(_surface.exactRequest, "endCamera");

                    _surface.exactTextureOwnershipTransferred = true;
                    CapturePolicy.RequireSingleCameraRenderRequestCaptureRoute(
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
                    var cleanupFailures = new List<Exception>();
                    AttemptCleanup(RestoreSpawnPointVisualizations, cleanupFailures);
                    AttemptCleanup(UnsubscribeAll, cleanupFailures);
                    if (_restoreBaselinesCaptured)
                    {
                        AttemptCleanup(RestoreOriginalCameraTargetTexture, cleanupFailures);
                        AttemptCleanup(RestoreRenderTextureActive, cleanupFailures);
                    }
                    if (_cameraBaselineVerified)
                    {
                        AttemptCleanup(
                            delegate
                            {
                                if (!ExactCameraStateMatches())
                                {
                                    RestoreExactCameraState();
                                }
                                CaptureExactCameraAfterState();
                                _owner.RequireLockedCameraState(_cameraState);
                            },
                            cleanupFailures);
                    }
                    if (_initialSurfaceStateCompleted)
                    {
                        AttemptCleanup(CaptureFinalSurfaceState, cleanupFailures);
                    }
                    AttemptCleanup(ReleaseAndDestroyOwnedRenderTexture, cleanupFailures);
                    if (_restoreBaselinesCaptured)
                    {
                        AttemptCleanup(RestoreRenderTextureActive, cleanupFailures);
                        _surface.renderTextureActiveRestoredAfterOperation =
                            RenderTextureActiveMatchesOriginal();
                    }
                    if (sentinelTexture != null)
                    {
                        UnityEngine.Object.Destroy(sentinelTexture);
                        _surface.sentinelTextureDestroyRequested = true;
                    }
                    if ((!exactOwnershipTransferred || cleanupFailures.Count > 0) &&
                        exactTexture != null)
                    {
                        UnityEngine.Object.Destroy(exactTexture);
                        _surface.returnedTextureDestroyRequested = true;
                        _surface.exactTextureOwnershipTransferred = false;
                    }
                    if (cleanupFailures.Count > 0)
                    {
                        Exception cleanupFailure = cleanupFailures.Count == 1
                            ? cleanupFailures[0]
                            : new AggregateException(cleanupFailures);
                        Exception combinedFailure = operationFailure == null
                            ? cleanupFailure
                            : new AggregateException(operationFailure, cleanupFailure);
                        throw new InvalidOperationException(
                            "SingleCameraRequest cleanup could not prove exact camera, target, and renderer-state restoration.",
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
                _cameraBaselineVerified = true;
                _originalCameraTargetTexture = _camera.targetTexture;
                _originalRenderTextureActive = RenderTexture.active;
                _restoreBaselinesCaptured = true;
                _surface.sceneCameraTargetTextureNullBeforeOperation =
                    _originalCameraTargetTexture == null;
                if (_originalCameraTargetTexture != null)
                {
                    throw new InvalidOperationException(
                        "The exact scene camera already has a target texture before SingleCameraRequest preflight.");
                }

                _entryPipeline = RenderPipelineManager.currentPipeline;
                _surface.entryPipelinePresent =
                    _entryPipeline != null && !_entryPipeline.disposed;
                _surface.entryPipelineTypeFullName = _entryPipeline == null
                    ? null
                    : _entryPipeline.GetType().FullName;
                _surface.entryPipelineRuntimeIdentityHashCode =
                    _entryPipeline == null
                        ? 0
                        : RuntimeHelpers.GetHashCode(_entryPipeline);
                if (_entryPipeline != null &&
                    (_entryPipeline.disposed ||
                        !String.Equals(
                            _surface.entryPipelineTypeFullName,
                            "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
                            StringComparison.Ordinal)))
                {
                    throw new InvalidOperationException(
                        "The entry render pipeline is disposed or is not the locked UniversalRenderPipeline.");
                }

                _pipelineAssetBeforePreflight = GraphicsSettings.currentRenderPipeline;
                _surface.graphicsSettingsAssetPresentBeforePreflight =
                    _pipelineAssetBeforePreflight != null;
                _surface.graphicsSettingsAssetTypeFullNameBeforePreflight =
                    _pipelineAssetBeforePreflight == null
                        ? null
                        : _pipelineAssetBeforePreflight.GetType().FullName;
                _surface.graphicsSettingsAssetInstanceIdBeforePreflight =
                    _pipelineAssetBeforePreflight == null
                        ? 0
                        : _pipelineAssetBeforePreflight.GetInstanceID();
                if (!_surface.graphicsSettingsAssetPresentBeforePreflight ||
                    !String.Equals(
                        _surface.graphicsSettingsAssetTypeFullNameBeforePreflight,
                        "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset",
                        StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "GraphicsSettings.currentRenderPipeline is not the locked UniversalRenderPipelineAsset.");
                }

                _surface.rendererConfigurationBeforePreflight =
                    SnapFrameReadbackOperation
                        .CaptureReadOnlyUrpRendererConfiguration();
                _surface.rendererConfigurationSignatureBeforeSha256 =
                    CapturePolicy.ComputeUrpRendererConfigurationSignature(
                        _surface.rendererConfigurationBeforePreflight);
                _surface.sceneCameraLive = IsLiveCamera(
                    _owner._sceneManager.SceneCamera);
                _surface.sceneCameraInstanceId = _surface.sceneCameraLive
                    ? _owner._sceneManager.SceneCamera.GetInstanceID()
                    : 0;
                _surface.captureViewAbsentBefore =
                    !_owner._captureManager.IsCaptureViewVisible;
                _surface.sceneCameraScreenRendererModeBefore =
                    _owner._sceneManager.SceneCameraScreenRenderer;
                _surface.exactPositionBefore = ToArray(_exactPosition);
                _surface.exactRotationXyzwBefore = ToArray(_exactRotation);
                _surface.exactWorldToCameraMatrixColumnMajorBefore =
                    MatrixToColumnMajor(_exactWorldToCamera);
                _surface.exactProjectionMatrixColumnMajorBefore =
                    MatrixToColumnMajor(_exactProjection);
                _surface.graphicsDeviceType =
                    SystemInfo.graphicsDeviceType.ToString();
                _surface.graphicsUvStartsAtTop =
                    SystemInfo.graphicsUVStartsAtTop;
                _surface.activeColorSpace =
                    QualitySettings.activeColorSpace.ToString();
                if (QualitySettings.activeColorSpace != ColorSpace.Gamma)
                {
                    throw new InvalidOperationException(
                        "The v14 capture contract requires Unity Gamma color space.");
                }
                _surface.readPixelsCoordinateOrigin =
                    CapturePolicy.SingleCameraRenderRequestReadPixelsCoordinateOrigin;
                _surface.cpuRowTransform =
                    CapturePolicy.SingleCameraRenderRequestCpuRowTransform;
                _surface.cpuOrientationStatus =
                    "unverified_pending_visual_qa";
                CaptureCameraConfiguration();
                CaptureOverlayInventory();
                CapturePotentialCameraCallbackContributors();
                RequireNoUnsafeSurfaceContributor();
                _initialSurfaceStateCompleted = true;
            }

            private void CreateOwnedRenderTexture()
            {
                if (_ownedRenderTexture != null)
                {
                    throw new InvalidOperationException(
                        "The request destination was already created.");
                }
                if (!SystemInfo.IsFormatSupported(
                    GraphicsFormat.R8G8B8A8_UNorm,
                    GraphicsFormatUsage.Render))
                {
                    throw new NotSupportedException(
                        "The locked graphics device cannot render to exact R8G8B8A8_UNorm.");
                }

                var descriptor = new RenderTextureDescriptor(
                    _owner._cameraProfile.Output.Width,
                    _owner._cameraProfile.Output.Height,
                    GraphicsFormat.R8G8B8A8_UNorm,
                    0,
                    1)
                {
                    dimension = TextureDimension.Tex2D,
                    volumeDepth = 1,
                    msaaSamples = 1,
                    mipCount = 1,
                    depthStencilFormat = GraphicsFormat.None,
                    useMipMap = false,
                    autoGenerateMips = false,
                    enableRandomWrite = false,
                    bindMS = false,
                    useDynamicScale = false,
                    useDynamicScaleExplicit = false,
                    memoryless = RenderTextureMemoryless.None,
                    sRGB = false
                };
                _requestedGraphicsFormat = descriptor.graphicsFormat.ToString();
                _requestedSrgb = descriptor.sRGB;
                if (!String.Equals(
                        _requestedGraphicsFormat,
                        GraphicsFormat.R8G8B8A8_UNorm.ToString(),
                        StringComparison.Ordinal) ||
                    _requestedSrgb)
                {
                    throw new InvalidOperationException(
                        "The explicit RenderTextureDescriptor request is not exact R8G8B8A8_UNorm with sRGB=false.");
                }
                _ownedRenderTexture = new RenderTexture(descriptor)
                {
                    name = "VenviewerGrandHallSingleCameraRequest-" +
                        _attempt.ordinal.ToString("D3", CultureInfo.InvariantCulture)
                };
                if (!_ownedRenderTexture.Create() ||
                    !_ownedRenderTexture.IsCreated())
                {
                    throw new InvalidOperationException(
                        "Unity did not create the module-owned SingleCameraRequest destination.");
                }
                RequireOwnedTargetReceipt(CaptureOwnedTarget());
            }

            private void EstablishLockedRenderPipelineBoundary()
            {
                ThrowIfAbortedOrStopped();
                RequireOwnedTargetReceipt(CaptureOwnedTarget());
                var request = new UniversalRenderPipeline.SingleCameraRequest
                {
                    destination = _ownedRenderTexture,
                    mipLevel = 0,
                    slice = 0,
                    face = CubemapFace.Unknown
                };
                _surface.capabilityPreflightCallCount = 1;
                _surface.capabilityPreflightDestinationInstanceId =
                    _ownedRenderTexture.GetInstanceID();
                _surface.capabilityPreflightBoundToExactOwnedDestination = true;
                _surface.capabilityPreflightSubmitRenderRequestInvoked = false;
                _surface.capabilityPreflightReadbackInvoked = false;
                _surface.capabilityPreflightSupportsRenderRequestReturnedTrue =
                    RenderPipeline.SupportsRenderRequest(_camera, request);

                _pipelineBefore = RenderPipelineManager.currentPipeline;
                _surface.establishedPipelinePresent =
                    _pipelineBefore != null && !_pipelineBefore.disposed;
                _surface.establishedPipelineTypeFullName = _pipelineBefore == null
                    ? null
                    : _pipelineBefore.GetType().FullName;
                _surface.establishedPipelineRuntimeIdentityHashCode =
                    _pipelineBefore == null
                        ? 0
                        : RuntimeHelpers.GetHashCode(_pipelineBefore);
                _surface.unityOwnedRuntimeInitializationOccurred =
                    !_surface.entryPipelinePresent &&
                    _surface.establishedPipelinePresent;
                _surface.disposableProcessOnlyRuntimeLifetime = true;
                _surface.persistentRenderPipelineAssetMutationClaimed = false;

                RenderPipelineAsset pipelineAssetAfterPreflight =
                    GraphicsSettings.currentRenderPipeline;
                _surface.graphicsSettingsAssetPresentAfterPreflight =
                    pipelineAssetAfterPreflight != null;
                _surface.graphicsSettingsAssetTypeFullNameAfterPreflight =
                    pipelineAssetAfterPreflight == null
                        ? null
                        : pipelineAssetAfterPreflight.GetType().FullName;
                _surface.graphicsSettingsAssetInstanceIdAfterPreflight =
                    pipelineAssetAfterPreflight == null
                        ? 0
                        : pipelineAssetAfterPreflight.GetInstanceID();

                if (!_surface.capabilityPreflightSupportsRenderRequestReturnedTrue ||
                    !_surface.establishedPipelinePresent ||
                    !String.Equals(
                        _surface.establishedPipelineTypeFullName,
                        "UnityEngine.Rendering.Universal.UniversalRenderPipeline",
                        StringComparison.Ordinal) ||
                    (_surface.entryPipelinePresent &&
                        !System.Object.ReferenceEquals(
                            _entryPipeline,
                            _pipelineBefore)) ||
                    !_surface.graphicsSettingsAssetPresentAfterPreflight ||
                    !System.Object.ReferenceEquals(
                        pipelineAssetAfterPreflight,
                        _pipelineAssetBeforePreflight) ||
                    !String.Equals(
                        _surface.graphicsSettingsAssetTypeFullNameAfterPreflight,
                        _surface.graphicsSettingsAssetTypeFullNameBeforePreflight,
                        StringComparison.Ordinal) ||
                    _surface.graphicsSettingsAssetInstanceIdAfterPreflight !=
                        _surface.graphicsSettingsAssetInstanceIdBeforePreflight)
                {
                    throw new InvalidOperationException(
                        "The public SingleCameraRequest capability preflight did not establish the exact locked URP while preserving its GraphicsSettings asset identity.");
                }

                _surface.rendererConfigurationAfterPreflight =
                    SnapFrameReadbackOperation
                        .CaptureReadOnlyUrpRendererConfiguration();
                _surface.rendererConfigurationSignatureAfterSha256 =
                    CapturePolicy.ComputeUrpRendererConfigurationSignature(
                        _surface.rendererConfigurationAfterPreflight);
                _surface.rendererConfigurationStableAcrossInitialization =
                    String.Equals(
                        _surface.rendererConfigurationSignatureBeforeSha256,
                        _surface.rendererConfigurationSignatureAfterSha256,
                        StringComparison.Ordinal);
                if (!_surface.rendererConfigurationStableAcrossInitialization)
                {
                    throw new InvalidOperationException(
                        "Unity-owned URP initialization changed the locked renderer-data or feature configuration.");
                }

                _surface.rendererInventoryBefore =
                    SnapFrameReadbackOperation.CaptureReadOnlyUrpRendererInventory(
                        _camera);
                CapturePolicy.RequireReadOnlyUrpRendererInventory(
                    _surface.rendererInventoryBefore);
                _surface.rendererStateSignatureBeforeSha256 =
                    CapturePolicy.ComputeUrpRendererStateSignature(
                        _surface.rendererInventoryBefore);
            }

            private SingleCameraRenderRequestInvocationReceipt ExecuteRequest(
                string stage,
                Vector3 expectedPosition,
                Quaternion expectedRotation,
                Matrix4x4 expectedWorldToCamera,
                out Texture2D texture)
            {
                ThrowIfAbortedOrStopped();
                if (_spawnPointSuppression == null)
                {
                    throw new InvalidOperationException(
                        "The generated spawn-point visualization suppression lease is absent.");
                }
                _spawnPointSuppression.RequireSuppressed();
                RequireCheckpoint(
                    expectedPosition,
                    expectedRotation,
                    expectedWorldToCamera);
                var invocation = new SingleCameraRenderRequestInvocationReceipt
                {
                    stage = stage,
                    requestNonce = CapturePolicy.Sha256Text(
                        _attempt.ordinal.ToString(CultureInfo.InvariantCulture) + "|" +
                        (++_requestOrdinal).ToString(CultureInfo.InvariantCulture) + "|" +
                        stage + "|" +
                        Time.frameCount.ToString(CultureInfo.InvariantCulture) + "|" +
                        Time.realtimeSinceStartupAsDouble.ToString(
                            "R",
                            CultureInfo.InvariantCulture)),
                    requestMipLevel = 0,
                    requestSlice = 0,
                    requestCubemapFace = CubemapFace.Unknown.ToString(),
                    requestDestinationInstanceId =
                        _ownedRenderTexture.GetInstanceID(),
                    requestDestinationMatchesOwnedTarget = true,
                    requestDirectTex2DMipZeroContract = true,
                    supportsRenderRequestCallCount = 0,
                    submitRenderRequestCallCount = 0,
                    targetBeforeSubmit = CaptureOwnedTarget(),
                    originalCameraTargetTextureNull =
                        _originalCameraTargetTexture == null,
                    originalCameraTargetTextureInstanceId =
                        _originalCameraTargetTexture == null
                            ? 0
                            : _originalCameraTargetTexture.GetInstanceID(),
                    callbacks = new List<SingleCameraRenderRequestCallbackReceipt>()
                };
                texture = null;
                Exception requestFailure = null;
                _activeInvocation = invocation;
                _stageExpectedPosition = expectedPosition;
                _stageExpectedRotation = expectedRotation;
                _stageExpectedWorldToCamera = expectedWorldToCamera;
                _callbackSequence = 0;
                SubscribeAll();
                try
                {
                    RenderPipeline currentPipeline =
                        RenderPipelineManager.currentPipeline;
                    if (currentPipeline == null || currentPipeline.disposed ||
                        !System.Object.ReferenceEquals(currentPipeline, _pipelineBefore))
                    {
                        throw new InvalidOperationException(
                            "The established locked URP instance drifted before SupportsRenderRequest.");
                    }
                    var request = new UniversalRenderPipeline.SingleCameraRequest
                    {
                        destination = _ownedRenderTexture,
                        mipLevel = 0,
                        slice = 0,
                        face = CubemapFace.Unknown
                    };
                    invocation.supportsRenderRequestCallCount = 1;
                    invocation.supportsRenderRequestReturnedTrue =
                        RenderPipeline.SupportsRenderRequest(_camera, request);
                    if (!invocation.supportsRenderRequestReturnedTrue)
                    {
                        throw new NotSupportedException(
                            "Locked URP rejected its public SingleCameraRequest contract.");
                    }
                    currentPipeline = RenderPipelineManager.currentPipeline;
                    invocation.pipelineIdentityVerifiedAfterSupports =
                        currentPipeline != null &&
                        !currentPipeline.disposed &&
                        System.Object.ReferenceEquals(
                            currentPipeline,
                            _pipelineBefore);
                    if (!invocation.pipelineIdentityVerifiedAfterSupports)
                    {
                        throw new InvalidOperationException(
                            "The locked URP identity changed during the request capability check.");
                    }
                    UrpRendererInventoryReceipt inventoryAfterSupports =
                        SnapFrameReadbackOperation.CaptureReadOnlyUrpRendererInventory(
                            _camera);
                    CapturePolicy.RequireReadOnlyUrpRendererInventory(
                        inventoryAfterSupports);
                    invocation.rendererStateVerifiedAfterSupports =
                        String.Equals(
                            CapturePolicy.ComputeUrpRendererStateSignature(
                                inventoryAfterSupports),
                            _surface.rendererStateSignatureBeforeSha256,
                            StringComparison.Ordinal);
                    if (!invocation.rendererStateVerifiedAfterSupports)
                    {
                        throw new InvalidOperationException(
                            "The locked URP renderer state changed during the request capability check.");
                    }
                    invocation.submitRenderRequestInvoked = true;
                    invocation.submitRenderRequestCallCount = 1;
                    _spawnPointSuppression.RequireSuppressed();
                    RenderPipeline.SubmitRenderRequest(_camera, request);
                    invocation.submitRenderRequestReturned = true;
                    _spawnPointSuppression.RequireSuppressed();
                }
                catch (Exception exception)
                {
                    invocation.submitRenderRequestThrew =
                        invocation.submitRenderRequestInvoked &&
                        !invocation.submitRenderRequestReturned;
                    invocation.submitFailureType = exception.GetType().FullName;
                    invocation.submitFailureMessage = exception.Message;
                    requestFailure = exception;
                }
                finally
                {
                    UnsubscribeAll();
                    invocation.callbackSubscriptionsRemoved =
                        !_beginContextSubscribed && !_beginCameraSubscribed &&
                        !_endCameraSubscribed && !_endContextSubscribed;
                    invocation.targetAfterSubmit = CaptureOwnedTarget();
                    invocation.targetIdentityAndDescriptorStable =
                        OwnedTargetsEqual(
                            invocation.targetBeforeSubmit,
                            invocation.targetAfterSubmit);
                    invocation.cameraTargetTextureRestored =
                        System.Object.ReferenceEquals(
                            _camera.targetTexture,
                            _originalCameraTargetTexture);
                    invocation.exactFourEventTranscriptVerified =
                        ExactFourEventTranscriptMatches(invocation);
                    _activeInvocation = null;
                }
                if (requestFailure != null)
                {
                    throw new InvalidOperationException(
                        "The locked URP SingleCameraRequest failed for " + stage + ".",
                        requestFailure);
                }
                if (invocation.callbackFailureObserved)
                {
                    throw new InvalidOperationException(
                        "A non-throwing render callback observer failed for " + stage + ": " +
                        invocation.callbackFailureMessage);
                }
                if (!invocation.exactFourEventTranscriptVerified ||
                    !invocation.cameraTargetTextureRestored ||
                    !invocation.targetIdentityAndDescriptorStable)
                {
                    throw new InvalidOperationException(
                        "The exact four-event request transcript, camera-target restoration, or owned-target identity proof failed for " +
                        stage + ".");
                }

                invocation.readback = new SingleCameraRenderRequestReadbackReceipt();
                texture = ReadOwnedRenderTexture(invocation.readback);
                _spawnPointSuppression.RequireSuppressed();
                return invocation;
            }

            private void RestoreSpawnPointVisualizations()
            {
                if (_spawnPointSuppression != null)
                {
                    _spawnPointSuppression.Restore();
                }
            }

            private Texture2D ReadOwnedRenderTexture(
                SingleCameraRenderRequestReadbackReceipt readback)
            {
                if (readback == null || _ownedRenderTexture == null ||
                    !_ownedRenderTexture.IsCreated())
                {
                    throw new InvalidOperationException(
                        "The owned request destination is unavailable for readback.");
                }
                int targetInstanceId = _ownedRenderTexture.GetInstanceID();
                RenderTexture previousActive = RenderTexture.active;
                readback.observationFrame = Time.frameCount;
                readback.sourceRenderTextureInstanceId = targetInstanceId;
                readback.sourceOwnedAndCreatedBeforeReadback = true;
                readback.width = _owner._cameraProfile.Output.Width;
                readback.height = _owner._cameraProfile.Output.Height;
                readback.renderTextureActiveWasNullBeforeReadback =
                    previousActive == null;
                readback.renderTextureActiveBeforeReadbackInstanceId =
                    previousActive == null ? 0 : previousActive.GetInstanceID();
                Texture2D texture = null;
                Exception readbackFailure = null;
                try
                {
                    RenderTexture.active = _ownedRenderTexture;
                    RenderTexture active = RenderTexture.active;
                    readback.renderTextureActiveBoundForReadbackInstanceId =
                        active == null ? 0 : active.GetInstanceID();
                    readback.exactOwnedRenderTextureActiveBeforeReadPixels =
                        active != null && active.GetInstanceID() == targetInstanceId;
                    if (!readback.exactOwnedRenderTextureActiveBeforeReadPixels)
                    {
                        throw new InvalidOperationException(
                            "RenderTexture.active did not bind the owned request destination.");
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
                    readback.firstPartyTextureNoMipChain =
                        texture.mipmapCount == 1;
                    readback.firstPartyTextureDistinctFromOwnedRenderTexture =
                        texture.GetInstanceID() != targetInstanceId;
                    byte[] rgb24 = ToRgb24(texture.GetPixels32());
                    readback.rgb24ByteLength = rgb24.LongLength;
                    readback.rgb24Sha256 = CapturePolicy.Sha256Bytes(rgb24);
                    readback.readbackCompletedAfterSubmitReturned = true;
                    if (texture.format != TextureFormat.RGB24 ||
                        !readback.firstPartyTextureReadable ||
                        !readback.firstPartyTextureNoMipChain ||
                        !readback.firstPartyTextureDistinctFromOwnedRenderTexture)
                    {
                        throw new InvalidDataException(
                            "The direct request readback is not a distinct readable RGB24 texture without mip levels.");
                    }
                }
                catch (Exception exception)
                {
                    readbackFailure = exception;
                }
                finally
                {
                    RenderTexture.active = previousActive;
                    RenderTexture restored = RenderTexture.active;
                    readback.renderTextureActiveWasNullAfterReadback =
                        restored == null;
                    readback.renderTextureActiveAfterReadbackInstanceId =
                        restored == null ? 0 : restored.GetInstanceID();
                    readback.renderTextureActiveRestored =
                        previousActive == null
                            ? restored == null
                            : restored != null && restored.GetInstanceID() ==
                                previousActive.GetInstanceID();
                }
                if (!readback.renderTextureActiveRestored || readbackFailure != null)
                {
                    if (texture != null)
                    {
                        UnityEngine.Object.Destroy(texture);
                    }
                    throw new InvalidOperationException(
                        "Direct RGB24 readback from the owned request destination failed or did not restore RenderTexture.active.",
                        readbackFailure);
                }
                if (_ownedRenderTexture == null ||
                    !_ownedRenderTexture.IsCreated() ||
                    _ownedRenderTexture.GetInstanceID() != targetInstanceId)
                {
                    UnityEngine.Object.Destroy(texture);
                    throw new InvalidOperationException(
                        "The owned request destination drifted across direct RGB24 readback.");
                }
                return texture;
            }

            private void CaptureCameraConfiguration()
            {
                _surface.sceneCameraPixelWidth = _camera.pixelWidth;
                _surface.sceneCameraPixelHeight = _camera.pixelHeight;
                _surface.sceneCameraCullingMask = _camera.cullingMask;
                _surface.sceneCameraTargetDisplay = _camera.targetDisplay;
                _surface.sceneCameraEnabledBefore = _camera.enabled;
                _surface.sceneCameraClearFlags = _camera.clearFlags.ToString();
                _surface.sceneCameraDepth = _camera.depth;
                _surface.sceneCameraRect = RectToArray(_camera.rect);
                _surface.sceneCameraPixelRect = RectToArray(_camera.pixelRect);
                UniversalAdditionalCameraData data =
                    _camera.GetComponent<UniversalAdditionalCameraData>();
                _surface.universalAdditionalCameraDataPresent = data != null;
                if (data != null)
                {
                    _surface.universalCameraRenderType =
                        data.renderType.ToString();
                    _surface.universalRenderPostProcessing =
                        data.renderPostProcessing;
                }
                _surface.cameraStackGetterInvoked = false;
                _surface.cameraStackBypassedByRequestContract = true;
                if (_surface.sceneCameraPixelWidth !=
                        _owner._cameraProfile.Output.Width ||
                    _surface.sceneCameraPixelHeight !=
                        _owner._cameraProfile.Output.Height ||
                    !_surface.universalAdditionalCameraDataPresent ||
                    !String.Equals(
                        _surface.universalCameraRenderType,
                        CameraRenderType.Base.ToString(),
                        StringComparison.Ordinal) ||
                    (_camera.clearFlags != CameraClearFlags.Color &&
                        _camera.clearFlags != CameraClearFlags.SolidColor &&
                        _camera.clearFlags != CameraClearFlags.Skybox))
                {
                    throw new InvalidOperationException(
                        "The exact scene camera is not a full-clear 1600x900 URP Base camera.");
                }
            }

            private void CaptureFinalSurfaceState()
            {
                _surface.captureViewAbsentAfter =
                    !_owner._captureManager.IsCaptureViewVisible;
                _surface.sceneCameraScreenRendererModeAfter =
                    _owner._sceneManager.SceneCameraScreenRenderer;
                _surface.sceneCameraTargetTextureNullAfterOperation =
                    _camera.targetTexture == null;
                _surface.sceneCameraCullingMaskAfter = _camera.cullingMask;
                _surface.sceneCameraTargetDisplayAfter = _camera.targetDisplay;
                _surface.sceneCameraEnabledAfter = _camera.enabled;
                _surface.sceneCameraClearFlagsAfter =
                    _camera.clearFlags.ToString();
                _surface.sceneCameraDepthAfter = _camera.depth;
                _surface.activeColorSpaceAfter =
                    QualitySettings.activeColorSpace.ToString();
                _surface.sceneCameraRectAfter = RectToArray(_camera.rect);
                _surface.sceneCameraPixelRectAfter = RectToArray(_camera.pixelRect);
                UniversalAdditionalCameraData data =
                    _camera.GetComponent<UniversalAdditionalCameraData>();
                _surface.universalAdditionalCameraDataPresentAfter = data != null;
                _surface.universalCameraRenderTypeAfter = data == null
                    ? null
                    : data.renderType.ToString();
                _surface.universalRenderPostProcessingAfter =
                    data != null && data.renderPostProcessing;
                RenderPipeline pipelineAfter =
                    RenderPipelineManager.currentPipeline;
                _surface.pipelinePresentAfterOperation =
                    pipelineAfter != null && !pipelineAfter.disposed;
                _surface.pipelineTypeFullNameAfterOperation = pipelineAfter == null
                    ? null
                    : pipelineAfter.GetType().FullName;
                _surface.pipelineRuntimeIdentityHashCodeAfterOperation = pipelineAfter == null
                    ? 0
                    : RuntimeHelpers.GetHashCode(pipelineAfter);
                _surface.pipelineRuntimeIdentityStableAfterEstablishment =
                    _surface.pipelinePresentAfterOperation &&
                    System.Object.ReferenceEquals(pipelineAfter, _pipelineBefore) &&
                    String.Equals(
                        _surface.pipelineTypeFullNameAfterOperation,
                        _surface.establishedPipelineTypeFullName,
                        StringComparison.Ordinal) &&
                    _surface.pipelineRuntimeIdentityHashCodeAfterOperation ==
                        _surface.establishedPipelineRuntimeIdentityHashCode;
                _surface.cameraConfigurationUnchanged =
                    _surface.sceneCameraCullingMaskAfter ==
                        _surface.sceneCameraCullingMask &&
                    _surface.sceneCameraTargetDisplayAfter ==
                        _surface.sceneCameraTargetDisplay &&
                    _surface.sceneCameraEnabledAfter ==
                        _surface.sceneCameraEnabledBefore &&
                    String.Equals(
                        _surface.sceneCameraClearFlagsAfter,
                        _surface.sceneCameraClearFlags,
                        StringComparison.Ordinal) &&
                    Math.Abs(
                        _surface.sceneCameraDepthAfter -
                        _surface.sceneCameraDepth) <=
                        CapturePolicy.ProjectionTolerance &&
                    String.Equals(
                        _surface.activeColorSpaceAfter,
                        _surface.activeColorSpace,
                        StringComparison.Ordinal) &&
                    _surface.universalAdditionalCameraDataPresentAfter ==
                        _surface.universalAdditionalCameraDataPresent &&
                    String.Equals(
                        _surface.universalCameraRenderTypeAfter,
                        _surface.universalCameraRenderType,
                        StringComparison.Ordinal) &&
                    _surface.universalRenderPostProcessingAfter ==
                        _surface.universalRenderPostProcessing &&
                    RectArraysEqual(
                        _surface.sceneCameraRectAfter,
                        _surface.sceneCameraRect) &&
                    RectArraysEqual(
                        _surface.sceneCameraPixelRectAfter,
                        _surface.sceneCameraPixelRect) &&
                    _camera.pixelWidth == _surface.sceneCameraPixelWidth &&
                    _camera.pixelHeight == _surface.sceneCameraPixelHeight &&
                    String.Equals(
                        _camera.clearFlags.ToString(),
                        _surface.sceneCameraClearFlags,
                        StringComparison.Ordinal) &&
                    System.Object.ReferenceEquals(
                        _camera.targetTexture,
                        _originalCameraTargetTexture);
                CaptureOverlayInventory();
                CapturePotentialCameraCallbackContributors();
                RequireNoUnsafeSurfaceContributor();
            }

            private void CapturePotentialCameraCallbackContributors()
            {
                string[] identities =
                    Resources.FindObjectsOfTypeAll<CameraDraw>()
                        .Where(candidate => candidate != null && candidate.enabled &&
                            candidate.gameObject != null &&
                            candidate.gameObject.activeInHierarchy)
                        .Select(candidate =>
                            candidate.GetType().FullName + "|" +
                            candidate.GetInstanceID().ToString(
                                CultureInfo.InvariantCulture) + "|" +
                            candidate.name)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(candidate => candidate, StringComparer.Ordinal)
                        .ToArray();
                string[] accumulatedIdentities =
                    (_surface.knownPotentialCameraCallbackContributorIdentities ??
                        new string[0])
                        .Concat(identities)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(candidate => candidate, StringComparer.Ordinal)
                        .ToArray();
                _surface.cameraCallbackContributorInventoryCompleted = true;
                _surface.knownPotentialCameraCallbackContributorIdentities =
                    accumulatedIdentities;
                _surface.knownPotentialCameraCallbackContributorCount =
                    accumulatedIdentities.Length;
                _surface.cameraCallbackContaminationExcluded =
                    accumulatedIdentities.Length == 0;
            }

            private void CaptureOverlayInventory()
            {
                var canvases = new List<NativeCanvasReceipt>();
                bool unsafeCanvas = false;
                int screenSpaceOverlayCount = 0;
                foreach (Canvas canvas in Resources.FindObjectsOfTypeAll<Canvas>())
                {
                    if (canvas == null || !canvas.enabled || canvas.gameObject == null ||
                        !canvas.gameObject.activeInHierarchy)
                    {
                        continue;
                    }
                    Camera worldCamera = canvas.worldCamera;
                    int layer = canvas.gameObject.layer;
                    bool layerIncluded = layer >= 0 && layer < 32 &&
                        (_camera.cullingMask & (1 << layer)) != 0;
                    bool worldCameraMatches = IsLiveCamera(worldCamera) &&
                        worldCamera.GetInstanceID() == _cameraInstanceId;
                    bool screenSpaceOverlay =
                        canvas.renderMode == UnityEngine.RenderMode.ScreenSpaceOverlay;
                    bool canRenderIntoRequest =
                        canvas.renderMode == UnityEngine.RenderMode.WorldSpace &&
                            layerIncluded ||
                        canvas.renderMode == UnityEngine.RenderMode.ScreenSpaceCamera &&
                            (worldCamera == null || worldCameraMatches);
                    if (screenSpaceOverlay)
                    {
                        screenSpaceOverlayCount += 1;
                    }
                    unsafeCanvas |= canRenderIntoRequest;
                    canvases.Add(new NativeCanvasReceipt
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
                        canRenderIntoRequest = canRenderIntoRequest,
                        excludedByNonNullTargetContract = screenSpaceOverlay
                    });
                }
                _surface.activeCanvases = canvases;
                _surface.unsafeCanvasObserved |= unsafeCanvas;
                _surface.activeScreenSpaceOverlayCanvasCount =
                    screenSpaceOverlayCount;
                _surface.screenSpaceOverlayExcludedByRequestContract =
                    canvases.Where(candidate => String.Equals(
                        candidate.renderMode,
                        UnityEngine.RenderMode.ScreenSpaceOverlay.ToString(),
                        StringComparison.Ordinal)).All(candidate =>
                            candidate.excludedByNonNullTargetContract &&
                            !candidate.canRenderIntoRequest);

                string[] currentOverlayNames =
                    Resources.FindObjectsOfTypeAll<GameObject>()
                        .Where(candidate => candidate != null &&
                            candidate.activeInHierarchy &&
                            IsKnownCaptureOverlayName(candidate.name))
                        .Select(candidate => candidate.name)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(candidate => candidate, StringComparer.Ordinal)
                        .ToArray();
                _surface.knownActiveCaptureOverlayNames =
                    (_surface.knownActiveCaptureOverlayNames ?? new string[0])
                        .Concat(currentOverlayNames)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(candidate => candidate, StringComparer.Ordinal)
                        .ToArray();
                _surface.knownActiveCaptureOverlayCount =
                    _surface.knownActiveCaptureOverlayNames.Length;
            }

            private void RequireNoUnsafeSurfaceContributor()
            {
                bool clean = _surface.sceneCameraLive &&
                    _surface.sceneCameraInstanceId == _cameraInstanceId &&
                    !_owner._captureManager.IsCaptureViewVisible &&
                    _owner._sceneManager.SceneCameraScreenRenderer &&
                    _surface.knownActiveCaptureOverlayCount == 0 &&
                    !_surface.unsafeCanvasObserved &&
                    !_owner._sceneManager.IsGridVisible &&
                    !_owner._sceneManager.IsSceneGizmoVisible &&
                    !_owner._sceneManager.ShowTrajectory &&
                    !_owner._sceneManager.SceneCameraInteraction &&
                    System.Object.ReferenceEquals(
                        _camera.targetTexture,
                        _originalCameraTargetTexture) &&
                    _camera.cullingMask == _surface.sceneCameraCullingMask &&
                    _camera.targetDisplay == _surface.sceneCameraTargetDisplay &&
                    RectArraysEqual(
                        RectToArray(_camera.rect),
                        _surface.sceneCameraRect) &&
                    RectArraysEqual(
                        RectToArray(_camera.pixelRect),
                        _surface.sceneCameraPixelRect);
                _surface.cleanViewStateVerifiedAtEveryCheckpoint &= clean;
                if (!clean)
                {
                    throw new InvalidOperationException(
                        "A camera-space/world-space Canvas, capture overlay, capture view, helper, target, or camera configuration could contaminate the request destination.");
                }
            }

            private void RequireCheckpoint(
                Vector3 expectedPosition,
                Quaternion expectedRotation,
                Matrix4x4 expectedWorldToCamera)
            {
                ThrowIfAbortedOrStopped();
                if (_ownedRenderTexture == null ||
                    !_ownedRenderTexture.IsCreated() ||
                    !PoseMatches(
                        _camera,
                        expectedPosition,
                        expectedRotation,
                        expectedWorldToCamera) ||
                    !MatrixApproximatelyEqual(
                        _camera.projectionMatrix,
                        _exactProjection) ||
                    !System.Object.ReferenceEquals(
                        _camera.targetTexture,
                        _originalCameraTargetTexture))
                {
                    throw new InvalidOperationException(
                        "The exact camera pose, projection, original target, or owned request destination drifted.");
                }
                RenderPipeline currentPipeline =
                    RenderPipelineManager.currentPipeline;
                if (currentPipeline == null || currentPipeline.disposed ||
                    !System.Object.ReferenceEquals(currentPipeline, _pipelineBefore))
                {
                    throw new InvalidOperationException(
                        "The initialized UniversalRenderPipeline instance drifted across a request checkpoint.");
                }
                CaptureOverlayInventory();
                RequireNoUnsafeSurfaceContributor();
                if (PositionsApproximatelyEqual(expectedPosition, _exactPosition))
                {
                    _owner.RequireLockedCameraState(_cameraState);
                }
                else
                {
                    _owner.RequireObservedUltraRenderAll();
                    if (!_owner._lccSceneManager.IsSceneLoaded(
                            CapturePolicy.CanonicalScenePath) ||
                        !_owner._lccSceneManager.HasEnvironment)
                    {
                        throw new InvalidOperationException(
                            "The canonical Grand Hall scene or renderer readiness drifted at the sentinel checkpoint.");
                    }
                }
            }

            private SingleCameraRenderRequestTargetReceipt CaptureOwnedTarget()
            {
                RenderTexture target = _ownedRenderTexture;
                return new SingleCameraRenderRequestTargetReceipt
                {
                    instanceId = target == null ? 0 : target.GetInstanceID(),
                    ownedByModule = target != null,
                    created = target != null && target.IsCreated(),
                    width = target == null ? 0 : target.width,
                    height = target == null ? 0 : target.height,
                    volumeDepth = target == null ? 0 : target.volumeDepth,
                    depthBits = target == null ? 0 : target.depth,
                    depthStencilFormat = target == null
                        ? null
                        : target.depthStencilFormat.ToString(),
                    antiAliasing = target == null ? 0 : target.antiAliasing,
                    mipCount = target == null
                        ? 0
                        : target.descriptor.mipCount,
                    dimension = target == null ? null : target.dimension.ToString(),
                    colorFormat = target == null ? null : target.format.ToString(),
                    requestedGraphicsFormat = _requestedGraphicsFormat,
                    requestedSrgb = _requestedSrgb,
                    effectiveGraphicsFormat = target == null
                        ? null
                        : target.graphicsFormat.ToString(),
                    effectiveGraphicsFormatRenderSupported = target != null &&
                        SystemInfo.IsFormatSupported(
                            target.graphicsFormat,
                            GraphicsFormatUsage.Render),
                    effectiveSrgb = target != null && target.sRGB,
                    requestedAndEffectiveFormatMatch = target != null &&
                        String.Equals(
                            _requestedGraphicsFormat,
                            target.graphicsFormat.ToString(),
                            StringComparison.Ordinal) &&
                        _requestedSrgb == target.sRGB,
                    useMipMap = target != null && target.useMipMap,
                    autoGenerateMips = target != null &&
                        target.autoGenerateMips,
                    useDynamicScale = target != null &&
                        target.useDynamicScale,
                    enableRandomWrite = target != null &&
                        target.enableRandomWrite
                };
            }

            private static void RequireOwnedTargetReceipt(
                SingleCameraRenderRequestTargetReceipt target)
            {
                if (target == null || target.instanceId == 0 ||
                    !target.ownedByModule || !target.created ||
                    target.width != CapturePolicy.CaptureWidth ||
                    target.height != CapturePolicy.CaptureHeight ||
                    target.volumeDepth != 1 || target.depthBits != 0 ||
                    !String.Equals(
                        target.depthStencilFormat,
                        GraphicsFormat.None.ToString(),
                        StringComparison.Ordinal) ||
                    target.antiAliasing != 1 ||
                    target.mipCount != 1 ||
                    !String.Equals(
                        target.dimension,
                        TextureDimension.Tex2D.ToString(),
                        StringComparison.Ordinal) ||
                    !String.Equals(
                        target.requestedGraphicsFormat,
                        GraphicsFormat.R8G8B8A8_UNorm.ToString(),
                        StringComparison.Ordinal) ||
                    target.requestedSrgb ||
                    !String.Equals(
                        target.effectiveGraphicsFormat,
                        target.requestedGraphicsFormat,
                        StringComparison.Ordinal) ||
                    !target.effectiveGraphicsFormatRenderSupported ||
                    target.effectiveSrgb != target.requestedSrgb ||
                    !target.requestedAndEffectiveFormatMatch ||
                    target.useMipMap ||
                    target.autoGenerateMips || target.useDynamicScale ||
                    target.enableRandomWrite)
                {
                    throw new InvalidOperationException(
                        "The module-owned request destination descriptor is not exact requested/effective R8G8B8A8_UNorm sRGB=false 1600x900 Tex2D, single-sample, depthless, and mipless.");
                }
            }

            private static bool OwnedTargetsEqual(
                SingleCameraRenderRequestTargetReceipt left,
                SingleCameraRenderRequestTargetReceipt right)
            {
                return left != null && right != null &&
                    left.instanceId == right.instanceId &&
                    left.ownedByModule == right.ownedByModule &&
                    left.created == right.created &&
                    left.width == right.width && left.height == right.height &&
                    left.volumeDepth == right.volumeDepth &&
                    left.depthBits == right.depthBits &&
                    String.Equals(
                        left.depthStencilFormat,
                        right.depthStencilFormat,
                        StringComparison.Ordinal) &&
                    left.antiAliasing == right.antiAliasing &&
                    left.mipCount == right.mipCount &&
                    String.Equals(left.dimension, right.dimension, StringComparison.Ordinal) &&
                    String.Equals(left.colorFormat, right.colorFormat, StringComparison.Ordinal) &&
                    String.Equals(
                        left.requestedGraphicsFormat,
                        right.requestedGraphicsFormat,
                        StringComparison.Ordinal) &&
                    left.requestedSrgb == right.requestedSrgb &&
                    String.Equals(
                        left.effectiveGraphicsFormat,
                        right.effectiveGraphicsFormat,
                        StringComparison.Ordinal) &&
                    left.effectiveGraphicsFormatRenderSupported ==
                        right.effectiveGraphicsFormatRenderSupported &&
                    left.effectiveSrgb == right.effectiveSrgb &&
                    left.requestedAndEffectiveFormatMatch ==
                        right.requestedAndEffectiveFormatMatch &&
                    left.useMipMap == right.useMipMap &&
                    left.autoGenerateMips == right.autoGenerateMips &&
                    left.useDynamicScale == right.useDynamicScale &&
                    left.enableRandomWrite == right.enableRandomWrite;
            }

            private void SubscribeAll()
            {
                RenderPipelineManager.beginContextRendering +=
                    _beginContextHandler;
                _beginContextSubscribed = true;
                RenderPipelineManager.beginCameraRendering +=
                    _beginCameraHandler;
                _beginCameraSubscribed = true;
                RenderPipelineManager.endCameraRendering +=
                    _endCameraHandler;
                _endCameraSubscribed = true;
                RenderPipelineManager.endContextRendering +=
                    _endContextHandler;
                _endContextSubscribed = true;
            }

            private void UnsubscribeAll()
            {
                if (_beginContextSubscribed)
                {
                    RenderPipelineManager.beginContextRendering -=
                        _beginContextHandler;
                    _beginContextSubscribed = false;
                }
                if (_beginCameraSubscribed)
                {
                    RenderPipelineManager.beginCameraRendering -=
                        _beginCameraHandler;
                    _beginCameraSubscribed = false;
                }
                if (_endCameraSubscribed)
                {
                    RenderPipelineManager.endCameraRendering -=
                        _endCameraHandler;
                    _endCameraSubscribed = false;
                }
                if (_endContextSubscribed)
                {
                    RenderPipelineManager.endContextRendering -=
                        _endContextHandler;
                    _endContextSubscribed = false;
                }
            }

            private void HandleBeginContextRendering(
                ScriptableRenderContext context,
                List<Camera> cameras)
            {
                TryRecordCallback("beginContext", cameras);
            }

            private void HandleBeginCameraRendering(
                ScriptableRenderContext context,
                Camera camera)
            {
                TryRecordCallback(
                    "beginCamera",
                    camera == null ? new List<Camera>() : new List<Camera> { camera });
            }

            private void HandleEndCameraRendering(
                ScriptableRenderContext context,
                Camera camera)
            {
                TryRecordCallback(
                    "endCamera",
                    camera == null ? new List<Camera>() : new List<Camera> { camera });
            }

            private void HandleEndContextRendering(
                ScriptableRenderContext context,
                List<Camera> cameras)
            {
                TryRecordCallback("endContext", cameras);
            }

            private void TryRecordCallback(string callback, List<Camera> cameras)
            {
                try
                {
                    RecordCallback(callback, cameras);
                }
                catch (Exception exception)
                {
                    SingleCameraRenderRequestInvocationReceipt invocation =
                        _activeInvocation;
                    if (invocation != null)
                    {
                        invocation.callbackFailureObserved = true;
                        invocation.callbackFailureType = exception.GetType().FullName;
                        invocation.callbackFailureMessage = exception.Message;
                    }
                }
            }

            private void RecordCallback(string callback, List<Camera> cameras)
            {
                SingleCameraRenderRequestInvocationReceipt invocation =
                    _activeInvocation;
                if (invocation == null)
                {
                    return;
                }
                if (invocation.callbacks.Count >= MaximumRecordedCallbacks)
                {
                    invocation.callbackHistoryOverflowed = true;
                    return;
                }

                int cameraCount = cameras == null ? 0 : cameras.Count;
                var cameraIds = new int[cameraCount];
                for (int index = 0; index < cameraCount; index += 1)
                {
                    Camera candidate = cameras[index];
                    cameraIds[index] = candidate == null
                        ? 0
                        : candidate.GetInstanceID();
                }
                bool exactCameraOnly = cameraCount == 1 &&
                    cameraIds[0] == _cameraInstanceId;
                RenderTexture liveTarget = _camera.targetTexture;
                int liveTargetId = liveTarget == null
                    ? 0
                    : liveTarget.GetInstanceID();
                int ownedTargetId = _ownedRenderTexture == null
                    ? 0
                    : _ownedRenderTexture.GetInstanceID();
                Camera evidenceCamera = exactCameraOnly ? cameras[0] : _camera;
                invocation.callbacks.Add(
                    new SingleCameraRenderRequestCallbackReceipt
                    {
                        sequence = ++_callbackSequence,
                        callback = callback,
                        requestNonce = invocation.requestNonce,
                        frame = Time.frameCount,
                        realtimeSeconds = Time.realtimeSinceStartupAsDouble,
                        cameraCount = cameraCount,
                        cameraInstanceIds = cameraIds,
                        exactSceneCameraOnly = exactCameraOnly,
                        cameraTargetMatchesOwnedRenderTexture =
                            liveTargetId != 0 && liveTargetId == ownedTargetId,
                        cameraTargetTextureInstanceId = liveTargetId,
                        poseMatchesRequestedStage = PoseMatches(
                            evidenceCamera,
                            _stageExpectedPosition,
                            _stageExpectedRotation,
                            _stageExpectedWorldToCamera),
                        projectionMatchesExactProfile =
                            evidenceCamera != null && MatrixApproximatelyEqual(
                                evidenceCamera.projectionMatrix,
                                _exactProjection),
                        position = evidenceCamera == null
                            ? null
                            : ToArray(evidenceCamera.transform.position),
                        rotationXyzw = evidenceCamera == null
                            ? null
                            : ToArray(evidenceCamera.transform.rotation),
                        worldToCameraMatrixColumnMajor = evidenceCamera == null
                            ? null
                            : MatrixToColumnMajor(
                                evidenceCamera.worldToCameraMatrix),
                        projectionMatrixColumnMajor = evidenceCamera == null
                            ? null
                            : MatrixToColumnMajor(
                                evidenceCamera.projectionMatrix)
                    });
            }

            private bool ExactFourEventTranscriptMatches(
                SingleCameraRenderRequestInvocationReceipt invocation)
            {
                if (invocation == null || invocation.callbackHistoryOverflowed ||
                    invocation.callbackFailureObserved ||
                    invocation.callbacks == null || invocation.callbacks.Count != 4)
                {
                    return false;
                }
                string[] expected =
                {
                    "beginContext",
                    "beginCamera",
                    "endCamera",
                    "endContext"
                };
                int frame = invocation.callbacks[0].frame;
                for (int index = 0; index < expected.Length; index += 1)
                {
                    SingleCameraRenderRequestCallbackReceipt callback =
                        invocation.callbacks[index];
                    if (callback == null || callback.sequence != index + 1 ||
                        !String.Equals(
                            callback.callback,
                            expected[index],
                            StringComparison.Ordinal) ||
                        callback.frame != frame || !callback.exactSceneCameraOnly ||
                        !callback.cameraTargetMatchesOwnedRenderTexture ||
                        !callback.poseMatchesRequestedStage ||
                        !callback.projectionMatchesExactProfile)
                    {
                        return false;
                    }
                }
                return true;
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
                _surface.exactPositionAfter =
                    ToArray(_camera.transform.position);
                _surface.exactRotationXyzwAfter =
                    ToArray(_camera.transform.rotation);
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
                    MatrixApproximatelyEqual(
                        _camera.projectionMatrix,
                        _exactProjection) &&
                    System.Object.ReferenceEquals(
                        _camera.targetTexture,
                        _originalCameraTargetTexture);
            }

            private void RestoreOriginalCameraTargetTexture()
            {
                if (!System.Object.ReferenceEquals(
                    _camera.targetTexture,
                    _originalCameraTargetTexture))
                {
                    _surface.cameraTargetTextureAssignedByModule = true;
                    _camera.targetTexture = _originalCameraTargetTexture;
                }
            }

            private void RestoreRenderTextureActive()
            {
                RenderTexture.active = _originalRenderTextureActive;
            }

            private bool RenderTextureActiveMatchesOriginal()
            {
                RenderTexture current = RenderTexture.active;
                return _originalRenderTextureActive == null
                    ? current == null
                    : current != null && current.GetInstanceID() ==
                        _originalRenderTextureActive.GetInstanceID();
            }

            private void ReleaseAndDestroyOwnedRenderTexture()
            {
                RenderTexture target = _ownedRenderTexture;
                if (target == null)
                {
                    return;
                }
                RenderTexture currentActive = RenderTexture.active;
                if (currentActive != null &&
                    currentActive.GetInstanceID() == target.GetInstanceID())
                {
                    RestoreRenderTextureActive();
                }
                if (target.IsCreated())
                {
                    target.Release();
                    _surface.ownedRenderTextureReleaseRequested = true;
                }
                _surface.ownedRenderTextureCreatedAfterRelease =
                    target.IsCreated();
                UnityEngine.Object.Destroy(target);
                _surface.ownedRenderTextureDestroyRequested = true;
                _ownedRenderTexture = null;
            }

            private void ThrowIfAbortedOrStopped()
            {
                if (Volatile.Read(ref _abortRequested) != 0 ||
                    _cancellation.IsCancellationRequested)
                {
                    throw new OperationCanceledException(
                        "The SingleCameraRequest operation was cancelled outside its synchronous submit call.");
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
                double tolerance =
                    _owner._cameraProfile.Frames.Native.AssertionTolerance;
                float rotationDot = Quaternion.Dot(
                    camera.transform.rotation,
                    expectedRotation);
                return IsFinite(camera.transform.position.x) &&
                    IsFinite(camera.transform.position.y) &&
                    IsFinite(camera.transform.position.z) &&
                    IsFinite(expectedPosition.x) && IsFinite(expectedPosition.y) &&
                    IsFinite(expectedPosition.z) && IsFinite(rotationDot) &&
                    Math.Abs(camera.transform.position.x - expectedPosition.x) <=
                        tolerance &&
                    Math.Abs(camera.transform.position.y - expectedPosition.y) <=
                        tolerance &&
                    Math.Abs(camera.transform.position.z - expectedPosition.z) <=
                        tolerance &&
                    Math.Abs(rotationDot) >= 0.999999 &&
                    MatrixApproximatelyEqual(
                        camera.worldToCameraMatrix,
                        expectedWorldToCamera);
            }

            private static bool MatrixApproximatelyEqual(
                Matrix4x4 left,
                Matrix4x4 right)
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

            private bool PositionsApproximatelyEqual(Vector3 left, Vector3 right)
            {
                double tolerance =
                    _owner._cameraProfile.Frames.Native.AssertionTolerance;
                return IsFinite(left.x) && IsFinite(left.y) && IsFinite(left.z) &&
                    IsFinite(right.x) && IsFinite(right.y) && IsFinite(right.z) &&
                    Math.Abs(left.x - right.x) <= tolerance &&
                    Math.Abs(left.y - right.y) <= tolerance &&
                    Math.Abs(left.z - right.z) <= tolerance;
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
                return String.Equals(
                        normalized,
                        "captureview",
                        StringComparison.Ordinal) ||
                    String.Equals(
                        normalized,
                        "capturemask",
                        StringComparison.Ordinal);
            }

            private static int CallbackFrame(
                SingleCameraRenderRequestInvocationReceipt invocation,
                string callbackName)
            {
                SingleCameraRenderRequestCallbackReceipt callback =
                    invocation.callbacks.First(candidate => String.Equals(
                        candidate.callback,
                        callbackName,
                        StringComparison.Ordinal));
                return callback.frame;
            }

            private static float[] RectToArray(Rect value)
            {
                return new[] { value.x, value.y, value.width, value.height };
            }

            private static bool RectArraysEqual(float[] left, float[] right)
            {
                if (left == null || right == null ||
                    left.Length != 4 || right.Length != 4)
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

            private static void AttemptCleanup(
                Action action,
                ICollection<Exception> failures)
            {
                try
                {
                    action();
                }
                catch (Exception exception)
                {
                    failures.Add(exception);
                }
            }
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

            internal static UrpRendererConfigurationReceipt
                CaptureReadOnlyUrpRendererConfiguration()
            {
                const string ObservationApi =
                    "GraphicsSettings.currentRenderPipeline + UniversalRenderPipelineAsset.rendererDataList + ScriptableRendererData.rendererFeatures";
                var receipt = new UrpRendererConfigurationReceipt
                {
                    observationApi = ObservationApi,
                    observationFrame = Time.frameCount,
                    observationRealtimeSeconds = Time.realtimeSinceStartupAsDouble,
                    publicConfigurationGettersOnly = true,
                    runtimeRendererOrSingletonApiInvoked = false,
                    mutationApiInvoked = false,
                    prohibitedRuntimeOrMutationApis =
                        CapturePolicy
                            .CreateUrpRendererConfigurationProhibitedRuntimeOrMutationApis(),
                    rendererData =
                        new List<UrpRendererConfigurationDataReceipt>()
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
                if (universalAsset == null)
                {
                    return receipt;
                }

                ReadOnlySpan<ScriptableRendererData> rendererDataSpan =
                    universalAsset.rendererDataList;
                receipt.rendererDataCount = rendererDataSpan.Length;
                var rendererDataReferences =
                    new ScriptableRendererData[rendererDataSpan.Length];
                var nativeRenderPassStates = new bool[rendererDataSpan.Length];
                var featureReferences =
                    new List<ScriptableRendererFeature[]>(rendererDataSpan.Length);
                var featureActiveStates = new List<bool[]>(rendererDataSpan.Length);

                for (int index = 0; index < rendererDataSpan.Length; index += 1)
                {
                    ScriptableRendererData rendererData = rendererDataSpan[index];
                    rendererDataReferences[index] = rendererData;
                    bool useNativeRenderPass = rendererData != null &&
                        rendererData.useNativeRenderPass;
                    nativeRenderPassStates[index] = useNativeRenderPass;
                    var dataReceipt = new UrpRendererConfigurationDataReceipt
                    {
                        rendererDataIndex = index,
                        present = rendererData != null,
                        name = rendererData == null ? null : rendererData.name,
                        typeFullName = rendererData == null
                            ? null
                            : rendererData.GetType().FullName,
                        instanceId = rendererData == null
                            ? 0
                            : rendererData.GetInstanceID(),
                        useNativeRenderPass = useNativeRenderPass,
                        features =
                            new List<UrpRendererConfigurationFeatureReceipt>()
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
                        string typeFullName = present
                            ? feature.GetType().FullName
                            : null;
                        bool isSnapFrame = String.Equals(
                            typeFullName,
                            CapturePolicy.SnapFrameFeatureTypeFullName,
                            StringComparison.Ordinal);
                        if (isSnapFrame)
                        {
                            dataReceipt.snapFrameCaptureFeatureCount += 1;
                            receipt.snapFrameCaptureFeatureCount += 1;
                            if (active)
                            {
                                receipt.activeSnapFrameCaptureFeatureCount += 1;
                            }
                        }
                        dataReceipt.features.Add(
                            new UrpRendererConfigurationFeatureReceipt
                            {
                                featureIndex = featureIndex,
                                present = present,
                                name = present ? feature.name : null,
                                typeFullName = typeFullName,
                                instanceId = present ? feature.GetInstanceID() : 0,
                                active = active,
                                snapFrameCaptureFeatureType = isSnapFrame
                            });
                    }
                    featureReferences.Add(entryFeatureReferences);
                    featureActiveStates.Add(entryFeatureActiveStates);
                    receipt.rendererData.Add(dataReceipt);
                }

                ReadOnlySpan<ScriptableRendererData> rendererDataAfter =
                    universalAsset.rendererDataList;
                bool configurationStable =
                    rendererDataAfter.Length == rendererDataReferences.Length;
                if (configurationStable)
                {
                    for (int dataIndex = 0;
                        dataIndex < rendererDataReferences.Length;
                        dataIndex += 1)
                    {
                        ScriptableRendererData rendererData = rendererDataAfter[dataIndex];
                        if (!System.Object.ReferenceEquals(
                                rendererData,
                                rendererDataReferences[dataIndex]) ||
                            (rendererData != null && rendererData.useNativeRenderPass) !=
                                nativeRenderPassStates[dataIndex])
                        {
                            configurationStable = false;
                            break;
                        }
                        List<ScriptableRendererFeature> currentFeatures =
                            rendererData == null ? null : rendererData.rendererFeatures;
                        ScriptableRendererFeature[] expectedFeatures =
                            featureReferences[dataIndex];
                        bool[] expectedActiveStates = featureActiveStates[dataIndex];
                        int currentFeatureCount = currentFeatures == null
                            ? 0
                            : currentFeatures.Count;
                        if (currentFeatureCount != expectedFeatures.Length)
                        {
                            configurationStable = false;
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
                                configurationStable = false;
                                break;
                            }
                        }
                        if (!configurationStable)
                        {
                            break;
                        }
                    }
                }
                receipt
                    .rendererDataFeatureIdentityAndActiveStateStableDuringSynchronousObservation =
                    configurationStable;
                receipt.mutationObservedDuringSynchronousObservation =
                    !configurationStable;
                return receipt;
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

                receipt.snapFrameStaticInstancePresent = false;
                receipt.snapFrameStaticInstanceId = 0;
                receipt.snapFrameStaticInstanceTypeFullName = null;

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
                        bool matchesStaticInstance = false;
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
                bool staticInstanceStable = true;
                receipt.snapFrameStaticInstanceStableDuringSynchronousInventory = true;
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
