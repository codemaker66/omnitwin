using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

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

    internal static class CapturePolicy
    {
        internal const string ArmValue = "CANONICAL_GH9_NATIVE_CAPTURE_V1";
        internal const string CanonicalScenePath =
            @"C:\GRAND_HALL_BIG_MODEL_VARIATIONS\scans_BIG_MODEL_TH_GH_9\lcc-result\Grand_Hall.lcc";
        internal const string CanonicalManifestSha256 =
            "CE2A539483C7C2A271CA2555F6390E16425BB911851A8A56C2F16B17C248CAC1";
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
        internal const double NativeCoordinateTolerance = 0.00001;
        internal const double ProjectionTolerance = 0.00001;
        internal const float VerticalFieldOfViewDegrees = 60.0f;
        internal const float NearClipMetres = 0.05f;
        internal const float FarClipMetres = 80.0f;
        internal const float AspectRatio = 16.0f / 9.0f;

        // Pose 19,890 is the source-position authority. The target is explicitly an
        // inspection-only horizontal q05/q95 pose-envelope centre, not a calibrated
        // source-camera orientation.
        internal static readonly Vec3d SourcePosition = new Vec3d(-4.774913, -16.59914, -0.687065);
        internal static readonly Vec3d SourceTarget = new Vec3d(-4.5826875, -8.392191, -0.687065);
        internal static readonly Vec3d SourceUp = new Vec3d(0.0, 0.0, 1.0);
        internal static readonly Vec3d ExpectedNativePosition = new Vec3d(4.774913, -0.687065, 16.59914);
        internal static readonly Vec3d ExpectedNativeTarget = new Vec3d(4.5826875, -0.687065, 8.392191);
        internal static readonly Vec3d ExpectedNativeUp = new Vec3d(0.0, 1.0, 0.0);
        internal static readonly Vec3d ExpectedNativeDirection =
            new Vec3d(-0.0234158630569611, 0.0, -0.999725811088869);

        internal static readonly double[] ExpectedNativeQuaternionXyzw =
            { 0.0, -0.999931450422695, 0.0, 0.0117087341572578 };

        internal static readonly ExpectedFile[] ExpectedInputFiles =
        {
            new ExpectedFile(
                @"assets\poses.json",
                2561254,
                "7A020E5F1CC00029CE773D1F448804FA1B7F16355412B023320975122556418D"),
            new ExpectedFile(
                "attrs.lcp",
                572,
                "2DE67E07AD085AB28855F79B67F5B6E5C6BD8485203E05C69E002D371CF7D54B"),
            new ExpectedFile(
                "collision.lci",
                1521440,
                "BA410F1E6FA7F93B1C4AE7DD2DBB0AEF211329DDE40E8E3D75D29204F45B5248"),
            new ExpectedFile(
                "data.bin",
                373926848,
                "18627958FCA65242C0B1702D26D772EC4B254F35C51B0C834DB53F926E308206"),
            new ExpectedFile(
                "environment.bin",
                1084416,
                "6FEE62EED083810490F370D2F6F9826C580036AB27AE49C863E9F5F05864C2D1"),
            new ExpectedFile(
                "Grand_Hall.lcc",
                1983,
                CanonicalManifestSha256),
            new ExpectedFile(
                "index.bin",
                672,
                "60605FAF37657F1FE426CCFAF5FC748E7DDEDEF00011F9A95FB4CD50F82E1C8C"),
            new ExpectedFile(
                "log.txt",
                2338,
                "A369B6316CE602C2488C692588E18A8B18A6A25DD41F243D6C3253A5FAC24094"),
            new ExpectedFile(
                "report.json",
                607,
                "4EBE53C9DE2C59A34D5748157F3581ACC929D59F75680F6B1CB15AA2944165CB"),
            new ExpectedFile(
                "shcoef.bin",
                747853696,
                "77B8D974244D3634F3AE1943FA139F2C5ECF1EC58CBFF5B69D86A7EF1BF5565B"),
            new ExpectedFile(
                "thumb.jpg",
                184943,
                "0C1B8D9A17DFA58E0C09F5E50DF10D989213BAD0CE510B07F96CC2A57589AB87")
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
                    "The loaded scene is not the locked canonical Grand Hall _9 LCC. Expected '" +
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
                .OrderBy(file => file.RelativePath, StringComparer.Ordinal)
                .Select(expected => SnapshotExpectedFile(root, expected))
                .ToList();
            return new PackageSnapshot(
                normalizedScenePath,
                receipts,
                InventorySha256(receipts));
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
                    "The canonical _9 package inventory differs from its locked 11-member receipt. " +
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
            using (SHA256 sha256 = SHA256.Create())
            {
                return ToHex(sha256.ComputeHash(Encoding.UTF8.GetBytes(value)));
            }
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
                    label + " is outside the raw _9 coordinate tolerance. Expected [" +
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
            foreach (FileReceipt receipt in receipts.OrderBy(item => item.RelativePath, StringComparer.Ordinal))
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
