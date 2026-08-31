using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Venviewer.NativeCapture
{
    internal struct Vec3d
    {
        internal Vec3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        internal double X { get; private set; }
        internal double Y { get; private set; }
        internal double Z { get; private set; }

        internal double[] ToArray()
        {
            return new[] { X, Y, Z };
        }

        public static Vec3d operator +(Vec3d left, Vec3d right)
        {
            return new Vec3d(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
        }
    }

    internal sealed class ExpectedFile
    {
        internal ExpectedFile(string relativePath, long byteLength, string sha256)
        {
            RelativePath = relativePath;
            ByteLength = byteLength;
            Sha256 = sha256;
        }

        internal string RelativePath { get; private set; }
        internal long ByteLength { get; private set; }
        internal string Sha256 { get; private set; }
    }

    internal sealed class FileReceipt
    {
        internal FileReceipt(
            string relativePath,
            string absolutePath,
            long byteLength,
            string sha256,
            long lastWriteTimeUtcTicks)
        {
            RelativePath = relativePath;
            AbsolutePath = absolutePath;
            ByteLength = byteLength;
            Sha256 = sha256;
            LastWriteTimeUtcTicks = lastWriteTimeUtcTicks;
        }

        internal string RelativePath { get; private set; }
        internal string AbsolutePath { get; private set; }
        internal long ByteLength { get; private set; }
        internal string Sha256 { get; private set; }
        internal long LastWriteTimeUtcTicks { get; private set; }
    }

    internal sealed class PackageSnapshot
    {
        internal PackageSnapshot(string scenePath, IList<FileReceipt> members, string inventorySha256)
        {
            ScenePath = scenePath;
            Members = members;
            InventorySha256 = inventorySha256;
        }

        internal string ScenePath { get; private set; }
        internal IList<FileReceipt> Members { get; private set; }
        internal string InventorySha256 { get; private set; }
    }

    internal sealed class InterlockedOneShotGate
    {
        private int _entered;

        internal bool TryEnter()
        {
            return Interlocked.CompareExchange(ref _entered, 1, 0) == 0;
        }
    }

    internal enum LifecycleExecutionDecision
    {
        Acquired,
        NotReady,
        Stopped,
        Duplicate
    }

    internal sealed class NativeCaptureLifecycleState
    {
        private readonly InterlockedOneShotGate _modulesLoadedGate = new InterlockedOneShotGate();
        private readonly InterlockedOneShotGate _executionGate = new InterlockedOneShotGate();
        private int _stopped;
        private int _nextFrameExecutionReady;

        internal bool IsStopped
        {
            get { return Volatile.Read(ref _stopped) != 0; }
        }

        internal bool TryScheduleModulesLoaded()
        {
            return !IsStopped && _modulesLoadedGate.TryEnter();
        }

        internal bool TryMarkNextFrameExecutionReady()
        {
            if (IsStopped)
            {
                return false;
            }

            Interlocked.Exchange(ref _nextFrameExecutionReady, 1);
            return !IsStopped;
        }

        internal LifecycleExecutionDecision TryEnterExecution()
        {
            if (IsStopped)
            {
                return LifecycleExecutionDecision.Stopped;
            }
            if (Volatile.Read(ref _nextFrameExecutionReady) == 0)
            {
                return LifecycleExecutionDecision.NotReady;
            }
            return _executionGate.TryEnter()
                ? LifecycleExecutionDecision.Acquired
                : LifecycleExecutionDecision.Duplicate;
        }

        internal void Stop()
        {
            Interlocked.Exchange(ref _stopped, 1);
        }
    }

    internal static class CapturePolicy
    {
        internal const string ArmValue = "CANONICAL_GH1_LCC2_NATIVE_CAPTURE_V1";
        internal const string CanonicalScenePath =
            @"C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_1\lcc2-result\Grand_Hall.lcc2";
        internal const string CanonicalManifestSha256 =
            "927A92699DE222E99D2684CA2567A35AB1E523A036461E6E01236B7B77B7F659";
        internal const string CanonicalInventorySha256 =
            "6013763AE4D9FA13CB10D2C62E9B11B971BC2F22420CA2ADE6F736AEECC4B793";
        internal const int CanonicalMemberCount = 60;
        internal const long CanonicalTotalByteLength = 214350601;
        internal const string CameraProfileFileName = "camera-profile.json";
        internal const string CameraProfileSha256 =
            "9ECA9B6582B7301EC1C059B1A5BE699E5A4983773AFECB2BEEA46C2668305922";
        internal const string InstalledVendorTreeRoot = @"F:\LccStudio";
        internal const string ApprovedSandboxEditorPath =
            @"C:\Users\blake\AppData\Local\Venviewer\lcc-native-capture-sandbox\lcceditor-0.15.0.7";
        internal const int CaptureWidth = 1600;
        internal const int CaptureHeight = 900;
        internal const int RequiredConsecutiveHashes = 3;
        internal const int MaximumCaptureAttempts = 60;
        internal const double MaximumConvergenceSeconds = 180.0;
        internal const int MinimumReadinessFrames = 300;
        internal const double MinimumReadinessSeconds = 15.0;
        internal const double MaximumReadinessSeconds = 180.0;
        internal const int FramesBetweenCaptureAttempts = 15;
        internal const double SceneLoadTimeoutSeconds = 180.0;
        internal const double PerCaptureTimeoutSeconds = 30.0;
        internal const int BlackChannelThreshold = 8;
        internal const double MinimumNonBlackPixelFraction = 0.05;
        internal const int MinimumMaximumChannelDynamicRange = 16;
        internal const int MinimumDistinctRgbCount = 64;
        internal const int DistinctRgbCountCap = 4096;
        internal const double MinimumLuminanceStandardDeviation = 2.0;
        internal const double NativeCoordinateTolerance = 0.00001;
        internal const double ProjectionTolerance = 0.00001;

        internal static void RequireUltraQuality(bool ultraQualityObserved)
        {
            if (!ultraQualityObserved)
            {
                throw new InvalidOperationException(
                    "The public renderer-quality service is not in Ultra mode.");
            }
        }

        internal static void RequireObservedUltraRenderAll(
            bool ultraQualityObserved,
            bool renderAllObserved)
        {
            RequireUltraQuality(ultraQualityObserved);
            if (!renderAllObserved)
            {
                throw new InvalidOperationException(
                    "The public renderer did not enter full-render mode after SetRenderAll(true).");
            }
        }

        internal static readonly ExpectedFile[] ExpectedInputFiles =
        {
            new ExpectedFile(@"data\3dgs\0_0_0_1_0_1.sog", 9980174, "97EFA65F9AADDBD69780664C6668817125C3153469918D5F291B348EE0B6D7E1"),
            new ExpectedFile(@"data\3dgs\0_0.sog", 7226379, "AD9EE1A5EDB4CDB07773BFCA8BAFC211BDA2C470820FFF310948EE1FA266F41D"),
            new ExpectedFile(@"data\3dgs\0_1_0_0_0.sog", 9287335, "E8DF50B2E00F48C25C394E870EB22FACF1EEE78FD24DAF1BB33D7B5BA3E24D97"),
            new ExpectedFile(@"data\3dgs\0_1_0_1_0_0.sog", 9500250, "2B0C0CCE30CB31A34B253D5985985B3D547DEBE8BCA1A97401EB72AB3AD3BDBF"),
            new ExpectedFile(@"data\3dgs\0_2_0_0_1_1.sog", 10575631, "B354BA55785E73A42AA4D108AC0C1FB93C333CBF5BD881E6C75149C2CECCCD3E"),
            new ExpectedFile(@"data\3dgs\0_2_0_1_0.sog", 9812960, "A2F5DC09CC3C8E0E6A64163D70D45DADBD0869CACC7F4C402B46BDA59917E79B"),
            new ExpectedFile(@"data\3dgs\0_2_0_1.sog", 9607542, "522B01AC0A8672688555A4824D41C9C382808E89444B3F3C93B80DFBF0D6EA6E"),
            new ExpectedFile(@"data\3dgs\0_3_0_0_0_0.sog", 10376269, "E590FB5D7488071C63F10DF33B31E451F3C0348C2209F1BF594015C28A1FFF24"),
            new ExpectedFile(@"data\3dgs\0_3_0_1_0_1.sog", 10207866, "84B2FF813E0746D8FC8DFCC9D044DBA15FEF5F62CA137794C30989C04BA82A9D"),
            new ExpectedFile(@"data\3dgs\0_4_0_0_0.sog", 10051936, "DE10E3AE76615FC1F1BFD5D029B13816AB21F860A816856A656F06B9F522E773"),
            new ExpectedFile(@"data\3dgs\0_4_0_1_0_0.sog", 9199768, "5863E052C6F99316914DF9168829543B82FB35DB0118B5E02D30E4D326A79D03"),
            new ExpectedFile(@"data\3dgs\0_5_0_0_0_1.sog", 8975642, "65FD21B69A1DEF23CB4BD5B756DA7AC03E4451A476A80A61C47B853A0366A8F1"),
            new ExpectedFile(@"data\3dgs\0_5_0_1_0_1.sog", 9708760, "D3272FEE659E486190AF1D2AC9427C39E5536BC85B90B5570DF4B6E9E9124631"),
            new ExpectedFile(@"data\3dgs\0_5_0_1_0.sog", 10453154, "C0856A3A2DCB4FC14CA4ED3A37DA258755CE047B8A009072A66C8D4EB413C27F"),
            new ExpectedFile(@"data\3dgs\0_5_0_1.sog", 10047647, "C1F2DBAEAC2C49F4E5B08122C72FEDA5B8DB73EA107B2C74F2FB2696C00BE9F2"),
            new ExpectedFile(@"data\3dgs\0_5_0.sog", 9819031, "64D22C432B8C275CBCDDA0F1C5A979FD3F7C6D735AF7BE9F5ACEB9D1AB5D0F1A"),
            new ExpectedFile(@"data\3dgs\0_6_0_0_0_1.sog", 10231737, "18E23290236BB3F220DF2B59F6F255A421151C0F1DA7ED633BD00D06EDDF0171"),
            new ExpectedFile(@"data\3dgs\0_6_0_0.sog", 7434360, "0553F77EEB242B620C4EE6FF9A34AC7DCB198DDD47C71E6856E6EED4CF8E052E"),
            new ExpectedFile(@"data\3dgs\0_6_0.sog", 4617467, "97434A3BC82407F5690E94023982D48516586AB6D95B12A140C5A1B01269F6D4"),
            new ExpectedFile(@"data\3dgs\0_7_0_0_0_0.sog", 9417293, "7C4CCA3644294C2955CFE9E41F387E70CE79E1AEDCCA132392C0493325CE4386"),
            new ExpectedFile(@"data\3dgs\0_7_0_0_0_1.sog", 8306348, "5E4409B07084CE7089E77A17D1EEC0D2C4691F7A9D9E52F55EF752529D356EA9"),
            new ExpectedFile(@"data\3dgs\0_7_0_0_0.sog", 9927441, "4C067908C5E62F1411E76EF470CC1F7F246200EAC2AC98255EBD3D946745229D"),
            new ExpectedFile(@"data\3dgs\0_7_0_1_0.sog", 4615298, "3AAB5477D7404D2A25E4D207CC167B6DEB9C54EDF9DDEC6DA255019487CA1F1C"),
            new ExpectedFile(@"data\3dgs\env.sog", 414176, "B74E7CD9899BBEA8AAD30B16C6512B43326C53A46C36FFD6CBD272EB48F914BD"),
            new ExpectedFile(@"data\mesh\0_0_0_0.btree", 10400, "22E2E03894CB2FA4444BF1C47027A0A23FD58D06DA3E93083D980731F26F227E"),
            new ExpectedFile(@"data\mesh\0_0_0_0.ply", 59614, "A0F5145330FAEF0A6AF7033A111157AFDFA8187C7C69D51924478380A390E5F6"),
            new ExpectedFile(@"data\mesh\0_0_0_1.btree", 17568, "933C2D273E5318E8CC6637D3D5BA03FE605F2E20067F21355E65D08F71CFE4DE"),
            new ExpectedFile(@"data\mesh\0_0_0_1.ply", 95601, "2E6F2B996CB2C0D1D4F9CD5E27E1EA01D9936AC950347CA2E9C3431FE9C2807C"),
            new ExpectedFile(@"data\mesh\0_1_0_0.btree", 10592, "EFAD491AB1668BA21FE9C5D605E776335E6C69AC41320905F2DC9E128A2D4F44"),
            new ExpectedFile(@"data\mesh\0_1_0_0.ply", 56472, "9670C93AF964B6EC5E3279885EE435945B8E9806ABFC52CDA11EC4D783D512D8"),
            new ExpectedFile(@"data\mesh\0_1_0_1.btree", 11360, "A060BBCF80F6D3B895D1849CB5AD3D5421DF27BABC9CF6D56FF74EFD60DA0112"),
            new ExpectedFile(@"data\mesh\0_1_0_1.ply", 60907, "45EF906B35CD00900989AEF02DC8D2A660D990B012B4CC6C7FEC2A9D45B1FC99"),
            new ExpectedFile(@"data\mesh\0_2_0_0.btree", 19616, "39AE181B5C1B4831B055B1E2EED8CF3B81FFF9B8922C285B7E8CEB2A77824FCF"),
            new ExpectedFile(@"data\mesh\0_2_0_0.ply", 92504, "64C3676FEAA64D5957A82B406F2003B7F277DD79EE6DE41EAB6D6747E94465E6"),
            new ExpectedFile(@"data\mesh\0_2_0_1.btree", 21920, "365EF5757D29EC8244AACD2AE6DE485C646E7637734C847AC9EF5499C280BFC6"),
            new ExpectedFile(@"data\mesh\0_2_0_1.ply", 106904, "A8720AF100A3058C78C225B6123A7DB43503EEC4A9A6982219E4F8C370CCB96E"),
            new ExpectedFile(@"data\mesh\0_3_0_0.btree", 21664, "746B0517451B5EB5F4FD6588542717A1088F8EADD8312852BEBD66FEE374F5B5"),
            new ExpectedFile(@"data\mesh\0_3_0_0.ply", 103803, "57D67F1A3412BCFB671826795564CBFEF7ADABB47C535A30C84639EFD490FE3E"),
            new ExpectedFile(@"data\mesh\0_3_0_1.btree", 24672, "09DE42FC898AAD7528578F674B174A72A839781F63D4813BF2228B141184C776"),
            new ExpectedFile(@"data\mesh\0_3_0_1.ply", 131163, "C052513ECD65865CA4928F9770F173D59A74F14F988D642E9D16F25E82DFD0A8"),
            new ExpectedFile(@"data\mesh\0_4_0_0.btree", 14624, "023856D08144341B30812E532DBEF4CE8CC7922847E087AFE9ABD2C3F442C414"),
            new ExpectedFile(@"data\mesh\0_4_0_0.ply", 78492, "062294E8CFC6ADFC5B9E25E5BE4F8EC9EE0E0831CCA2314FECB922F35FC98FAF"),
            new ExpectedFile(@"data\mesh\0_4_0_1.btree", 21216, "ED039A171D0EB495E3B3071B8F05A92A9152622106F6A1A76ACAC30D6A52BDA2"),
            new ExpectedFile(@"data\mesh\0_4_0_1.ply", 114787, "0269DB7EF7797DE96EC366EC66041FF2D78E7641856E00DECABEF00232AAC4B8"),
            new ExpectedFile(@"data\mesh\0_5_0_0.btree", 14624, "2BEDCD2E9B6D82BE113E2992CBDD37E6C3A70B9CEC95DD9DCDC9AA3856727004"),
            new ExpectedFile(@"data\mesh\0_5_0_0.ply", 73736, "76DA4FCAAC288F175CAC4198E88CD67F66247C3AC035D40C059F25019B7FEF80"),
            new ExpectedFile(@"data\mesh\0_5_0_1.btree", 20832, "EB5A28751AE698E6D3FEB9A326DDF32389C1C9DB7494FD8AFD2C4BEE673FC798"),
            new ExpectedFile(@"data\mesh\0_5_0_1.ply", 101298, "2CA56769115830E95D430C9AA53800C9FDFE1C502483A92F4E37722D92463C00"),
            new ExpectedFile(@"data\mesh\0_6_0_0.btree", 15328, "E1B0C9848326A9F362A11D4EF03ECCFF0666BF3BFDEAC843CBD43B108672CE76"),
            new ExpectedFile(@"data\mesh\0_6_0_0.ply", 80410, "90A793D116A7010EB6092918A4BA5AA756EE060761CAC83E5AC0915D4BAA369E"),
            new ExpectedFile(@"data\mesh\0_6_0_1.btree", 17824, "758D30FDA88EAE6D99928936ACE1B6D6EE3F378DC59654E3AF8721C16B839D3A"),
            new ExpectedFile(@"data\mesh\0_6_0_1.ply", 100133, "7E577753C3B2527DDC84CA28373DB88141AE29C87B7ACC3EF01EFCA32A2B33B9"),
            new ExpectedFile(@"data\mesh\0_7_0_0.btree", 8672, "BC1AFC71132EF1A2D5A6115F762A009E8B067DE63E60D58F1C3E7FDA047808B1"),
            new ExpectedFile(@"data\mesh\0_7_0_0.ply", 46592, "7EEB1E1FA4D3D7A7189D9119AF25CB2334C070FD7F585C481064CB7F03917C19"),
            new ExpectedFile(@"data\mesh\0_7_0_1.btree", 20960, "85113A25D3A4ADFB60D363296EC323DDDCB4A245869EF8BFB7D5040637B273FE"),
            new ExpectedFile(@"data\mesh\0_7_0_1.ply", 110975, "BFC91D2CCDE0328E8A013144875BE4FC8E1D86DC8AA811A4DAF384AF57F79389"),
            new ExpectedFile("Grand_Hall.lcc2", 124070, CanonicalManifestSha256),
            new ExpectedFile(@"info\poses.json", 2561254, "7A020E5F1CC00029CE773D1F448804FA1B7F16355412B023320975122556418D"),
            new ExpectedFile(@"info\report.json", 607, "4EBE53C9DE2C59A34D5748157F3581ACC929D59F75680F6B1CB15AA2944165CB"),
            new ExpectedFile(@"info\thumb.jpg", 184943, "0C1B8D9A17DFA58E0C09F5E50DF10D989213BAD0CE510B07F96CC2A57589AB87")
        };

        internal static string NormalizePath(string path)
        {
            if (String.IsNullOrWhiteSpace(path))
            {
                throw new InvalidOperationException("A non-empty absolute path is required.");
            }

            string fullPath = Path.GetFullPath(path);
            string root = Path.GetPathRoot(fullPath);
            if (String.IsNullOrEmpty(root))
            {
                throw new InvalidOperationException("The path must be absolute: " + path);
            }

            if (String.Equals(fullPath, root, StringComparison.OrdinalIgnoreCase))
            {
                return fullPath;
            }

            return fullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        internal static void RequireCanonicalScenePath(string actualScenePath)
        {
            string actual = NormalizePath(actualScenePath);
            string expected = NormalizePath(CanonicalScenePath);
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The loaded scene is not the locked canonical Grand Hall GH_1 LCC2. Expected '" +
                    expected + "' but received '" + actual + "'.");
            }
        }

        internal static string RequireEmptySafeOutputDirectory(
            string outputDirectory,
            string editorRoot)
        {
            string output = NormalizePath(outputDirectory);
            string sourceRoot = NormalizePath(Path.GetDirectoryName(CanonicalScenePath));
            string normalizedEditorRoot = NormalizePath(editorRoot);

            if (!Directory.Exists(output))
            {
                throw new DirectoryNotFoundException(
                    "The capture output directory must already exist: " + output);
            }

            RequirePathWithoutReparsePoints(output, "capture output directory");

            if (IsSameOrChildPath(output, sourceRoot))
            {
                throw new InvalidOperationException(
                    "The output directory must not be the canonical source directory or one of its children.");
            }

            if (IsSameOrChildPath(output, normalizedEditorRoot))
            {
                throw new InvalidOperationException(
                    "The output directory must not be inside the disposable LCCEditor tree.");
            }

            if (Directory.EnumerateFileSystemEntries(output).Any())
            {
                throw new InvalidOperationException(
                    "The output directory must be empty so this run cannot overwrite earlier evidence: " + output);
            }

            return output;
        }

        internal static string RequireApprovedSandboxEditorRoot(
            string actualEditorRoot,
            string operatorDeclaredEditorRoot)
        {
            string actual = NormalizePath(actualEditorRoot);
            string declared = NormalizePath(operatorDeclaredEditorRoot);
            string approved = NormalizePath(ApprovedSandboxEditorPath);
            string vendorTree = NormalizePath(InstalledVendorTreeRoot);
            if (IsSameOrChildPath(actual, vendorTree))
            {
                throw new InvalidOperationException(
                    "The armed module must never run from the installed F:\\LccStudio vendor tree.");
            }

            if (!String.Equals(actual, approved, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(declared, approved, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The actual and operator-declared editor roots must both equal the approved disposable sandbox: " +
                    approved + ".");
            }

            if (!Directory.Exists(actual))
            {
                throw new DirectoryNotFoundException("The approved disposable editor does not exist: " + actual);
            }

            RequirePathWithoutReparsePoints(actual, "approved disposable editor");
            return actual;
        }

        internal static void RequirePathWithoutReparsePoints(string path, string label)
        {
            string current = NormalizePath(path);
            while (!String.IsNullOrEmpty(current))
            {
                var info = new DirectoryInfo(current);
                if (info.Exists && (info.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw new InvalidOperationException(
                        label + " contains a reparse-point ancestor: " + info.FullName);
                }

                string parent = Path.GetDirectoryName(current);
                if (String.IsNullOrEmpty(parent) ||
                    String.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                current = parent;
            }
        }

        internal static void RequireTreeWithoutReparsePoints(string rootPath, string label)
        {
            string root = NormalizePath(rootPath);
            var pending = new Stack<DirectoryInfo>();
            pending.Push(new DirectoryInfo(root));
            while (pending.Count > 0)
            {
                DirectoryInfo directory = pending.Pop();
                if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw new InvalidOperationException(label + " contains a reparse point: " + directory.FullName);
                }

                foreach (FileSystemInfo entry in directory.GetFileSystemInfos())
                {
                    if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                    {
                        throw new InvalidOperationException(label + " contains a reparse point: " + entry.FullName);
                    }

                    var child = entry as DirectoryInfo;
                    if (child != null)
                    {
                        pending.Push(child);
                    }
                }
            }
        }

        internal static bool IsSameOrChildPath(string candidatePath, string parentPath)
        {
            string candidate = NormalizePath(candidatePath);
            string parent = NormalizePath(parentPath);
            if (String.Equals(candidate, parent, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            string prefix = parent + Path.DirectorySeparatorChar;
            return candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }

        internal static string RequireSha256(string value, string label)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length != 64 ||
                value.Any(character => !Uri.IsHexDigit(character)))
            {
                throw new InvalidOperationException(label + " must be exactly 64 hexadecimal characters.");
            }

            return value.ToUpperInvariant();
        }

        internal static PackageSnapshot SnapshotCanonicalPackage(string scenePath)
        {
            RequireCanonicalScenePath(scenePath);
            string normalizedScenePath = NormalizePath(scenePath);
            string root = NormalizePath(Path.GetDirectoryName(normalizedScenePath));
            RequirePathWithoutReparsePoints(root, "canonical Grand Hall package");
            RequireTreeWithoutReparsePoints(root, "canonical Grand Hall package tree");
            RequireCanonicalInventory(root);

            List<FileReceipt> receipts = ExpectedInputFiles
                .Select(expected => SnapshotExpectedFile(root, expected))
                .ToList();
            var snapshot = new PackageSnapshot(
                normalizedScenePath,
                receipts,
                InventorySha256(receipts));
            long totalByteLength = receipts.Sum(receipt => receipt.ByteLength);
            if (receipts.Count != CanonicalMemberCount || totalByteLength != CanonicalTotalByteLength ||
                !String.Equals(snapshot.InventorySha256, CanonicalInventorySha256, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "The canonical GH_1 LCC2 inventory aggregate differs from the locked 60-file receipt. " +
                    "Expected " + CanonicalInventorySha256 + " but found " +
                    snapshot.InventorySha256 + ".");
            }

            return snapshot;
        }

        private static void RequireCanonicalInventory(string root)
        {
            string[] actualRelativePaths = Directory.GetFiles(root, "*", SearchOption.AllDirectories)
                .Select(path => RelativePath(root, path))
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            string[] expectedRelativePaths = ExpectedInputFiles
                .Select(file => file.RelativePath)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();

            if (!actualRelativePaths.SequenceEqual(expectedRelativePaths, StringComparer.Ordinal))
            {
                throw new InvalidOperationException(
                    "The canonical GH_1 LCC2 package inventory differs from its locked 60-member receipt. " +
                    "Expected [" + String.Join(", ", expectedRelativePaths) + "] but found [" +
                    String.Join(", ", actualRelativePaths) + "].");
            }
        }

        private static FileReceipt SnapshotExpectedFile(string root, ExpectedFile expected)
        {
            string fullPath = NormalizePath(Path.Combine(root, expected.RelativePath));
            var info = new FileInfo(fullPath);
            if (!info.Exists)
            {
                throw new FileNotFoundException("A locked canonical package member is missing.", fullPath);
            }

            if (info.Length != expected.ByteLength)
            {
                throw new InvalidOperationException(
                    expected.RelativePath + " byte length changed. Expected " +
                    expected.ByteLength.ToString(CultureInfo.InvariantCulture) + " but found " +
                    info.Length.ToString(CultureInfo.InvariantCulture) + ".");
            }

            string sha256 = Sha256File(fullPath);
            if (!String.Equals(sha256, expected.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    expected.RelativePath + " SHA-256 changed. Expected " + expected.Sha256 +
                    " but found " + sha256 + ".");
            }

            info.Refresh();
            return new FileReceipt(
                expected.RelativePath,
                fullPath,
                info.Length,
                sha256,
                info.LastWriteTimeUtc.Ticks);
        }

        internal static void RequireUnchanged(PackageSnapshot before, PackageSnapshot after)
        {
            if (before == null || after == null)
            {
                throw new ArgumentNullException(before == null ? "before" : "after");
            }

            if (!String.Equals(before.ScenePath, after.ScenePath, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(before.InventorySha256, after.InventorySha256, StringComparison.OrdinalIgnoreCase) ||
                before.Members.Count != after.Members.Count)
            {
                throw new InvalidOperationException("The canonical package identity changed during capture.");
            }

            for (int index = 0; index < before.Members.Count; index += 1)
            {
                FileReceipt first = before.Members[index];
                FileReceipt second = after.Members[index];
                if (!String.Equals(first.RelativePath, second.RelativePath, StringComparison.Ordinal) ||
                    first.ByteLength != second.ByteLength ||
                    !String.Equals(first.Sha256, second.Sha256, StringComparison.OrdinalIgnoreCase) ||
                    first.LastWriteTimeUtcTicks != second.LastWriteTimeUtcTicks)
                {
                    throw new InvalidOperationException(
                        "The canonical package member changed during capture: " + first.RelativePath);
                }
            }
        }

        internal static string Sha256File(string path)
        {
            using (var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                1024 * 1024,
                FileOptions.SequentialScan))
            using (SHA256 sha256 = SHA256.Create())
            {
                return ToHex(sha256.ComputeHash(stream));
            }
        }

        internal static string Sha256Text(string value)
        {
            return Sha256Bytes(Encoding.UTF8.GetBytes(value));
        }

        internal static string Sha256Bytes(byte[] value)
        {
            if (value == null)
            {
                throw new ArgumentNullException("value");
            }

            using (SHA256 sha256 = SHA256.Create())
            {
                return ToHex(sha256.ComputeHash(value));
            }
        }

        internal static RasterStatisticsReceipt AnalyzeRgb24(byte[] rgb24, int width, int height)
        {
            if (rgb24 == null)
            {
                throw new ArgumentNullException("rgb24");
            }
            if (width <= 0 || height <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    "width",
                    "Raster dimensions must both be positive.");
            }

            long pixelCount = checked((long)width * height);
            long expectedByteLength = checked(pixelCount * 3L);
            if (rgb24.LongLength != expectedByteLength)
            {
                throw new InvalidDataException(
                    "The decoded RGB24 raster has " +
                    rgb24.LongLength.ToString(CultureInfo.InvariantCulture) +
                    " bytes; expected " + expectedByteLength.ToString(CultureInfo.InvariantCulture) + ".");
            }

            int minimumRed = 255;
            int maximumRed = 0;
            int minimumGreen = 255;
            int maximumGreen = 0;
            int minimumBlue = 255;
            int maximumBlue = 0;
            long nonBlackPixelCount = 0;
            long observedPixelCount = 0;
            double meanLuminance = 0.0;
            double luminanceM2 = 0.0;
            var distinctRgb = new HashSet<int>();

            for (int offset = 0; offset < rgb24.Length; offset += 3)
            {
                int red = rgb24[offset];
                int green = rgb24[offset + 1];
                int blue = rgb24[offset + 2];
                minimumRed = Math.Min(minimumRed, red);
                maximumRed = Math.Max(maximumRed, red);
                minimumGreen = Math.Min(minimumGreen, green);
                maximumGreen = Math.Max(maximumGreen, green);
                minimumBlue = Math.Min(minimumBlue, blue);
                maximumBlue = Math.Max(maximumBlue, blue);
                if (red > BlackChannelThreshold ||
                    green > BlackChannelThreshold ||
                    blue > BlackChannelThreshold)
                {
                    nonBlackPixelCount += 1;
                }

                if (distinctRgb.Count < DistinctRgbCountCap)
                {
                    distinctRgb.Add((red << 16) | (green << 8) | blue);
                }

                double luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
                observedPixelCount += 1;
                double delta = luminance - meanLuminance;
                meanLuminance += delta / observedPixelCount;
                luminanceM2 += delta * (luminance - meanLuminance);
            }

            return new RasterStatisticsReceipt
            {
                pixelCount = pixelCount,
                nonBlackPixelCount = nonBlackPixelCount,
                nonBlackPixelFraction = (double)nonBlackPixelCount / pixelCount,
                minimumRed = minimumRed,
                maximumRed = maximumRed,
                minimumGreen = minimumGreen,
                maximumGreen = maximumGreen,
                minimumBlue = minimumBlue,
                maximumBlue = maximumBlue,
                maximumChannelDynamicRange = Math.Max(
                    maximumRed - minimumRed,
                    Math.Max(maximumGreen - minimumGreen, maximumBlue - minimumBlue)),
                distinctRgbLowerBound = distinctRgb.Count,
                distinctRgbCountCapped = distinctRgb.Count == DistinctRgbCountCap,
                meanLuminance = meanLuminance,
                luminanceStandardDeviation = Math.Sqrt(luminanceM2 / pixelCount),
                rgb24Sha256 = Sha256Bytes(rgb24),
                nonDegenerateVerified = false
            };
        }

        internal static void RequireNonDegenerateRaster(
            RasterStatisticsReceipt statistics,
            int expectedWidth,
            int expectedHeight)
        {
            if (statistics == null)
            {
                throw new ArgumentNullException("statistics");
            }

            long expectedPixelCount = checked((long)expectedWidth * expectedHeight);
            if (statistics.pixelCount != expectedPixelCount ||
                statistics.nonBlackPixelFraction < MinimumNonBlackPixelFraction ||
                statistics.maximumChannelDynamicRange < MinimumMaximumChannelDynamicRange ||
                statistics.distinctRgbLowerBound < MinimumDistinctRgbCount ||
                statistics.luminanceStandardDeviation < MinimumLuminanceStandardDeviation)
            {
                throw new InvalidDataException(
                    "The decoded capture is blank or near-constant and cannot enter hash convergence. " +
                    "Observed non-black fraction " +
                    statistics.nonBlackPixelFraction.ToString("R", CultureInfo.InvariantCulture) +
                    ", maximum channel range " +
                    statistics.maximumChannelDynamicRange.ToString(CultureInfo.InvariantCulture) +
                    ", distinct RGB lower bound " +
                    statistics.distinctRgbLowerBound.ToString(CultureInfo.InvariantCulture) +
                    ", and luminance standard deviation " +
                    statistics.luminanceStandardDeviation.ToString("R", CultureInfo.InvariantCulture) + ".");
            }

            statistics.nonDegenerateVerified = true;
        }

        internal static string ReceiptInventorySha256(IEnumerable<FileReceipt> receipts)
        {
            return InventorySha256(receipts);
        }

        internal static string RelativePathUnderRoot(string root, string path)
        {
            return RelativePath(root, path);
        }

        internal static Vec3d RawLccSourceToUnity(Vec3d source)
        {
            return new Vec3d(-source.X, source.Z, -source.Y);
        }

        internal static void RequireApproximatelyEqual(
            string label,
            Vec3d actual,
            Vec3d expected,
            double tolerance)
        {
            if (Math.Abs(actual.X - expected.X) > tolerance ||
                Math.Abs(actual.Y - expected.Y) > tolerance ||
                Math.Abs(actual.Z - expected.Z) > tolerance)
            {
                throw new InvalidOperationException(
                    label + " is outside the fixed-camera coordinate tolerance. Expected [" +
                    FormatVector(expected) + "] but received [" + FormatVector(actual) +
                    "] with tolerance " + tolerance.ToString("R", CultureInfo.InvariantCulture) + ".");
            }
        }

        internal static void RequirePngDimensions(string path, int expectedWidth, int expectedHeight)
        {
            var header = new byte[24];
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (stream.Length <= header.Length || stream.Read(header, 0, header.Length) != header.Length)
                {
                    throw new InvalidDataException("The capture is too short to be a PNG: " + path);
                }
            }

            byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
            for (int index = 0; index < signature.Length; index += 1)
            {
                if (header[index] != signature[index])
                {
                    throw new InvalidDataException("The capture does not have a PNG signature: " + path);
                }
            }

            if (header[12] != (byte)'I' || header[13] != (byte)'H' ||
                header[14] != (byte)'D' || header[15] != (byte)'R')
            {
                throw new InvalidDataException("The capture does not begin with a PNG IHDR chunk: " + path);
            }

            int width = ReadBigEndianInt32(header, 16);
            int height = ReadBigEndianInt32(header, 20);
            if (width != expectedWidth || height != expectedHeight)
            {
                throw new InvalidDataException(
                    "The capture dimensions are " + width.ToString(CultureInfo.InvariantCulture) + "x" +
                    height.ToString(CultureInfo.InvariantCulture) + "; expected " +
                    expectedWidth.ToString(CultureInfo.InvariantCulture) + "x" +
                    expectedHeight.ToString(CultureInfo.InvariantCulture) + ".");
            }
        }

        private static string RelativePath(string root, string path)
        {
            string normalizedRoot = NormalizePath(root) + Path.DirectorySeparatorChar;
            string normalizedPath = NormalizePath(path);
            if (!normalizedPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The file is outside the expected root: " + normalizedPath);
            }

            return normalizedPath.Substring(normalizedRoot.Length)
                .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
        }

        private static string InventorySha256(IEnumerable<FileReceipt> receipts)
        {
            var builder = new StringBuilder();
            foreach (FileReceipt receipt in receipts)
            {
                builder.Append(receipt.RelativePath);
                builder.Append('|');
                builder.Append(receipt.ByteLength.ToString(CultureInfo.InvariantCulture));
                builder.Append('|');
                builder.Append(receipt.Sha256.ToUpperInvariant());
                builder.Append('\n');
            }

            return Sha256Text(builder.ToString());
        }

        private static int ReadBigEndianInt32(byte[] bytes, int offset)
        {
            return (bytes[offset] << 24) |
                   (bytes[offset + 1] << 16) |
                   (bytes[offset + 2] << 8) |
                   bytes[offset + 3];
        }

        private static string ToHex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes)
            {
                builder.Append(value.ToString("X2", CultureInfo.InvariantCulture));
            }

            return builder.ToString();
        }

        private static string FormatVector(Vec3d value)
        {
            return value.X.ToString("R", CultureInfo.InvariantCulture) + ", " +
                   value.Y.ToString("R", CultureInfo.InvariantCulture) + ", " +
                   value.Z.ToString("R", CultureInfo.InvariantCulture);
        }
    }
}
