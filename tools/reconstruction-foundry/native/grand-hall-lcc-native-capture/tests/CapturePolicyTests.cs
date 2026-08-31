using System;
using System.Collections.Generic;
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
            "blackChannelThreshold",
            "minimumNonBlackPixelFraction",
            "minimumMaximumChannelDynamicRange",
            "minimumDistinctRgbCount",
            "minimumLuminanceStandardDeviation",
            "everyAttemptDecodedAndNonDegenerate"
        })
        {
            if (!fields.Contains(expected))
            {
                throw new InvalidOperationException(
                    "Native render-mode receipt field is missing: " + expected);
            }
        }
        if (fields.Contains("fullRenderSupported") ||
            fields.Contains("vendorFullRenderBudgetEligibilityReported"))
        {
            throw new InvalidOperationException(
                "A misleading SupportFullRender receipt field remains.");
        }
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
            "beforeRenderCallbackInvoked",
            "afterRenderCallbackInvoked",
            "renderProbeSubscriptionRemoved",
            "renderTargetAssignedBeforeCapture",
            "renderTargetInstanceId",
            "renderTargetWidth",
            "renderTargetHeight",
            "renderTargetDriftObserved",
            "exactCameraRenderCallbackCount",
            "firstExactCameraRenderFrame",
            "lastExactCameraRenderFrame",
            "captureTaskCompletedBeforeDeadline",
            "captureTaskTimeoutObserved",
            "lateCaptureTaskObserverAttached",
            "underlyingCaptureCancellationAvailable",
            "textureFormat",
            "textureReadable",
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

    private static void ExpectThrows<TException>(Action action)
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

        throw new InvalidOperationException("Expected exception " + typeof(TException).FullName + ".");
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
